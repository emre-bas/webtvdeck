import { legacyEncoding } from '../i18n/language';
import { clearDatabase, deletePlaylistData, saveChannels } from '../lib/db';
import { decodeText, fetchText } from '../lib/fetch-text';
import { createId } from '../lib/id';
import { parsePlaylist } from '../lib/parse-playlist';
import { forgetProxiedOrigins } from '../lib/proxy';
import type { Channel, PlaylistMeta } from '../lib/types';
import { setChannels } from './actions';
import { guideUrlOf, openGuide } from './guide';
import { useLibrary } from './library';
import { getProxyConfig, whenProxyKnown } from './proxy';
import { useSession } from './session';

export type PlaylistSource = { kind: 'url'; url: string } | { kind: 'file'; file: File };

/** What the playlist form edits besides the source. Empty strings clear a value. */
export interface PlaylistFields {
  name?: string;
  epgOverride?: string;
  userAgent?: string;
}

export interface ImportProgress {
  stage: 'download' | 'parse' | 'save';
  loaded?: number;
  total?: number;
}

type ProgressHandler = (progress: ImportProgress) => void;

export async function importPlaylist(
  source: PlaylistSource,
  fields: PlaylistFields = {},
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<{ playlist: PlaylistMeta; unsupported: number }> {
  const userAgent = fields.userAgent?.trim() || undefined;
  const { channels, epgUrl, unsupported } = await readPlaylist(source, userAgent, onProgress, signal);
  signal?.throwIfAborted();
  onProgress?.({ stage: 'save' });

  const now = Date.now();
  const epgOverride = fields.epgOverride?.trim() || undefined;
  const playlist: PlaylistMeta = {
    id: createId(),
    name: fields.name?.trim() || defaultName(source),
    ...sourceFields(source),
    ...(epgUrl ? { epgUrl } : {}),
    ...(epgOverride ? { epgOverride } : {}),
    ...(userAgent ? { userAgent } : {}),
    channelCount: channels.length,
    groupCount: countGroups(channels),
    addedAt: now,
    updatedAt: now,
  };
  await saveChannels(playlist.id, channels);
  useLibrary.getState().addPlaylist(playlist);
  // Ask the browser not to evict the channel database under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
  return { playlist, unsupported };
}

/**
 * Saves the playlist form. A new `source` (another link, or a new file) is read first and
 * replaces the channels; favorites and history keep working for streams whose URL stays.
 */
export async function savePlaylist(
  id: string,
  fields: PlaylistFields,
  source?: PlaylistSource,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<{ playlist: PlaylistMeta; unsupported: number }> {
  const before = findPlaylist(id);
  if (!before) throw new Error('Playlist not found');

  const userAgent = fields.userAgent?.trim() || undefined;
  const patch: Partial<PlaylistMeta> = {
    name: fields.name?.trim() || before.name,
    epgOverride: fields.epgOverride?.trim() || undefined,
    userAgent,
  };

  let channels: Channel[] | undefined;
  let unsupported = 0;
  if (source) {
    const result = await readPlaylist(source, userAgent, onProgress, signal);
    signal?.throwIfAborted();
    onProgress?.({ stage: 'save' });
    await saveChannels(id, result.channels);
    ({ channels, unsupported } = result);
    Object.assign(patch, {
      url: undefined,
      fileName: undefined,
      ...sourceFields(source),
      // The guide announced by the old source belongs to it.
      epgUrl: result.epgUrl,
      channelCount: channels.length,
      groupCount: countGroups(channels),
      updatedAt: Date.now(),
    });
  }

  useLibrary.getState().updatePlaylist(id, patch);
  const playlist = findPlaylist(id)!;
  const session = useSession.getState();
  if (session.playlistId === id) {
    if (channels) setChannels(channels);
    const guideChanged = guideUrlOf(playlist) !== guideUrlOf(before) || playlist.userAgent !== before.userAgent;
    if (channels || guideChanged) void openGuide(id, channels ?? session.channels);
  }
  return { playlist, unsupported };
}

/** Downloads a URL playlist again and replaces its channels (favorites keep working by URL). */
export async function refreshPlaylist(id: string): Promise<PlaylistMeta> {
  const playlist = findPlaylist(id);
  if (!playlist?.url) throw new Error('Playlist has no URL');

  const { channels, epgUrl } = await readPlaylist({ kind: 'url', url: playlist.url }, playlist.userAgent);
  await saveChannels(id, channels);
  const patch: Partial<PlaylistMeta> = {
    channelCount: channels.length,
    groupCount: countGroups(channels),
    updatedAt: Date.now(),
    epgUrl: epgUrl ?? playlist.epgUrl,
  };
  useLibrary.getState().updatePlaylist(id, patch);
  if (useSession.getState().playlistId === id) {
    setChannels(channels);
    void openGuide(id, channels);
  }
  return { ...playlist, ...patch };
}

export async function deletePlaylist(id: string): Promise<void> {
  await deletePlaylistData(id).catch(() => {});
  useLibrary.getState().removePlaylist(id);
}

export async function resetApp(): Promise<void> {
  await clearDatabase().catch(() => {});
  forgetProxiedOrigins();
  useLibrary.getState().reset();
  useSession.setState({ playlistId: null, loadState: 'idle', channels: [], request: null, previous: null, drawerOpen: false });
}

/** The small list of public test streams shipped with the app. */
export function demoUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}demo.m3u`, window.location.href).href;
}

/** Another playlist that already uses this link. */
export function findPlaylistByUrl(url: string, exceptId?: string): PlaylistMeta | undefined {
  return useLibrary.getState().playlists.find((playlist) => playlist.url === url && playlist.id !== exceptId);
}

function findPlaylist(id: string): PlaylistMeta | undefined {
  return useLibrary.getState().playlists.find((playlist) => playlist.id === id);
}

function sourceFields(source: PlaylistSource): Pick<PlaylistMeta, 'url' | 'fileName'> {
  return source.kind === 'url' ? { url: source.url } : { fileName: source.file.name };
}

async function readPlaylist(source: PlaylistSource, userAgent?: string, onProgress?: ProgressHandler, signal?: AbortSignal) {
  const encoding = legacyEncoding(useLibrary.getState().settings.language);
  onProgress?.({ stage: 'download' });

  let text: string;
  let baseUrl: string | undefined;
  if (source.kind === 'file') {
    text = decodeText(new Uint8Array(await source.file.arrayBuffer()), encoding);
  } else {
    await whenProxyKnown();
    const result = await fetchText(source.url, getProxyConfig(userAgent ?? ''), {
      signal,
      fallbackEncoding: encoding,
      onProgress: (loaded, total) => onProgress?.({ stage: 'download', loaded, total }),
    });
    text = result.text;
    baseUrl = result.finalUrl;
  }

  signal?.throwIfAborted();
  onProgress?.({ stage: 'parse' });
  const parsed = await parsePlaylist(text, { baseUrl });
  return { channels: parsed.channels, epgUrl: parsed.epgUrls[0], unsupported: parsed.unsupported };
}

function defaultName(source: PlaylistSource): string {
  if (source.kind === 'file') return source.file.name.replace(/\.(m3u8?|txt)$/i, '') || source.file.name;
  try {
    return new URL(source.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Playlist';
  }
}

function countGroups(channels: Channel[]): number {
  return new Set(channels.map((channel) => channel.group ?? '')).size;
}
