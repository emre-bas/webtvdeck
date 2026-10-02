import { useMemo } from 'react';
import { BUILT_IN_PROXY } from '../lib/proxy';
import type { Channel } from '../lib/types';
import { useLibrary } from './library';
import { useSession } from './session';

const NO_URLS: string[] = [];

/** Same rules as getProxyConfig(), as a hook. */
export function useProxyEndpoint(): string | null {
  const mode = useLibrary((state) => state.settings.proxyMode);
  const custom = useLibrary((state) => state.settings.proxyUrl.trim());
  const builtIn = useSession((state) => state.builtInProxy);
  if (mode === 'off') return null;
  return custom || (builtIn ? BUILT_IN_PROXY : null);
}

export function useFavoriteUrls(): string[] {
  const playlistId = useSession((state) => state.playlistId);
  return useLibrary((state) => (playlistId ? (state.favorites[playlistId] ?? NO_URLS) : NO_URLS));
}

export function useFavoriteSet(): Set<string> {
  const urls = useFavoriteUrls();
  return useMemo(() => new Set(urls), [urls]);
}

export function useCurrentChannel(): Channel | null {
  return useSession((state) => state.request?.channel ?? null);
}

export function useActivePlaylist() {
  const id = useLibrary((state) => state.activePlaylistId);
  return useLibrary((state) => state.playlists.find((playlist) => playlist.id === id) ?? null);
}
