import { create } from 'zustand';
import { loadGuide, saveGuide } from '../lib/db';
import { downloadGuide, GuideError } from '../lib/epg/download';
import { channelKey, type GuideData, type GuideFilter } from '../lib/epg/xmltv';
import type { Channel, PlaylistMeta } from '../lib/types';
import { useLibrary } from './library';
import { getProxyConfig, whenProxyKnown } from './proxy';

interface GuideState {
  playlistId: string | null;
  data: GuideData | null;
  fetchedAt: number | null;
  programmes: number;
  /** A download is running; the previous guide stays visible meanwhile. */
  updating: boolean;
  error: GuideError | null;
}

/** Programme guide (EPG) of the open playlist. */
export const useGuide = create<GuideState>()(() => ({
  playlistId: null,
  data: null,
  fetchedAt: null,
  programmes: 0,
  updating: false,
  error: null,
}));

const MAX_AGE_MS = 12 * 3_600_000;

/** The user's override wins over the url-tvg announced by the playlist. */
export function guideUrlOf(playlist: PlaylistMeta | undefined): string | undefined {
  return playlist?.epgOverride || playlist?.epgUrl;
}

/** Shows the stored guide right away and downloads a new one when it's stale or its URL changed. */
export async function openGuide(playlistId: string, channels: Channel[]): Promise<void> {
  useGuide.setState({ playlistId, data: null, fetchedAt: null, programmes: 0, updating: false, error: null });
  const url = guideUrlOf(findPlaylist(playlistId));
  if (!url) return;

  const stored = await loadGuide(playlistId).catch(() => null);
  if (useGuide.getState().playlistId !== playlistId) return;
  if (stored?.url === url) {
    useGuide.setState({ data: stored.data, fetchedAt: stored.fetchedAt, programmes: stored.programmes });
    if (Date.now() - stored.fetchedAt < MAX_AGE_MS) return;
  }
  await refreshGuide(playlistId, channels);
}

export async function refreshGuide(playlistId: string, channels: Channel[]): Promise<void> {
  const playlist = findPlaylist(playlistId);
  const url = guideUrlOf(playlist);
  if (!url || useGuide.getState().updating) return;
  useGuide.setState({ updating: true, error: null });

  try {
    await whenProxyKnown();
    const proxy = getProxyConfig(playlist?.userAgent ?? '');
    const { data, programmes } = await downloadGuide(url, buildFilter(channels, Date.now()), proxy);
    const fetchedAt = Date.now();
    await saveGuide({ playlistId, url, fetchedAt, programmes, data }).catch(() => {});
    if (useGuide.getState().playlistId === playlistId) useGuide.setState({ data, fetchedAt, programmes, updating: false });
  } catch (error) {
    if (useGuide.getState().playlistId !== playlistId) return;
    useGuide.setState({ updating: false, error: error instanceof GuideError ? error : new GuideError('network') });
  }
}

function findPlaylist(id: string): PlaylistMeta | undefined {
  return useLibrary.getState().playlists.find((playlist) => playlist.id === id);
}

/** Only programmes of this playlist's channels, from a little before now to a day and a half ahead. */
function buildFilter(channels: Channel[], now: number): GuideFilter {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const channel of channels) {
    if (channel.tvgId) ids.add(channel.tvgId.toLowerCase());
    const key = channelKey(channel.tvgName || channel.name);
    if (key) names.add(key);
  }
  return { ids: [...ids], names: [...names], from: now - 3 * 3_600_000, to: now + 36 * 3_600_000 };
}
