import { BUILT_IN_PROXY, detectBuiltInProxy, type ProxyConfig } from '../lib/proxy';
import { useLibrary } from './library';
import { useSession } from './session';

let detection: Promise<void> | null = null;

/** Resolves once we know whether the server hosting the app also runs the stream proxy. */
export function whenProxyKnown(): Promise<void> {
  detection ??= detectBuiltInProxy().then((available) => useSession.setState({ builtInProxy: available }));
  return detection;
}

/**
 * Proxy settings for a request. `userAgent` is the playlist's own User-Agent (empty for none);
 * it defaults to the open playlist's, and the global setting applies when there isn't one.
 */
export function getProxyConfig(userAgent = openPlaylistUserAgent()): ProxyConfig {
  const { settings } = useLibrary.getState();
  const custom = settings.proxyUrl.trim();
  const fallback = useSession.getState().builtInProxy ? BUILT_IN_PROXY : null;
  return {
    endpoint: settings.proxyMode === 'off' ? null : custom || fallback,
    mode: settings.proxyMode,
    userAgent: userAgent.trim() || settings.userAgent.trim(),
  };
}

function openPlaylistUserAgent(): string {
  const { playlistId } = useSession.getState();
  return useLibrary.getState().playlists.find((playlist) => playlist.id === playlistId)?.userAgent ?? '';
}
