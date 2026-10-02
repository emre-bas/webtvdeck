import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { detectLanguage, type Language } from '../i18n/language';
import type { ProxyMode } from '../lib/proxy';
import type { PlaylistMeta } from '../lib/types';

export interface HistoryEntry {
  url: string;
  at: number;
}

/** How much of the video shows through the menu. */
export type MenuStyle = 'clear' | 'tinted' | 'solid';

export interface Settings {
  language: Language;
  menuStyle: MenuStyle;
  /** Start the last watched channel when the app opens. */
  autoplayLast: boolean;
  proxyMode: ProxyMode;
  /** Custom proxy endpoint; empty uses the built-in one when the app is served with it. */
  proxyUrl: string;
  /** User-Agent for proxied requests; empty keeps the browser's. */
  userAgent: string;
  volume: number;
  muted: boolean;
}

interface LibraryState {
  playlists: PlaylistMeta[];
  activePlaylistId: string | null;
  /** Per playlist: stream URLs of favorite channels, in the order they were added. */
  favorites: Record<string, string[]>;
  /** Per playlist: recently watched channels, newest first. */
  history: Record<string, HistoryEntry[]>;
  settings: Settings;
}

interface LibraryActions {
  addPlaylist: (playlist: PlaylistMeta) => void;
  updatePlaylist: (id: string, patch: Partial<PlaylistMeta>) => void;
  removePlaylist: (id: string) => void;
  setActivePlaylist: (id: string) => void;
  /** Returns whether the channel is a favorite afterwards. */
  toggleFavorite: (playlistId: string, url: string) => boolean;
  recordWatched: (playlistId: string, url: string) => void;
  clearHistory: (playlistId: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const HISTORY_LIMIT = 50;

function initialState(): LibraryState {
  return {
    playlists: [],
    activePlaylistId: null,
    favorites: {},
    history: {},
    settings: {
      language: detectLanguage(),
      menuStyle: 'clear',
      autoplayLast: true,
      proxyMode: 'auto',
      proxyUrl: '',
      userAgent: '',
      volume: 1,
      muted: false,
    },
  };
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/** Everything the user owns: playlists, favorites, history and settings (localStorage). */
export const useLibrary = create<LibraryState & LibraryActions>()(
  persist(
    (set, get) => ({
      ...initialState(),

      addPlaylist: (playlist) =>
        set((state) => ({ playlists: [...state.playlists, playlist], activePlaylistId: playlist.id })),

      updatePlaylist: (id, patch) =>
        set((state) => ({ playlists: state.playlists.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      removePlaylist: (id) =>
        set((state) => {
          const playlists = state.playlists.filter((p) => p.id !== id);
          return {
            playlists,
            activePlaylistId: state.activePlaylistId === id ? (playlists[0]?.id ?? null) : state.activePlaylistId,
            favorites: without(state.favorites, id),
            history: without(state.history, id),
          };
        }),

      setActivePlaylist: (id) => set({ activePlaylistId: id }),

      toggleFavorite: (playlistId, url) => {
        const current = get().favorites[playlistId] ?? [];
        const isFavorite = current.includes(url);
        set((state) => ({
          favorites: {
            ...state.favorites,
            [playlistId]: isFavorite ? current.filter((u) => u !== url) : [...current, url],
          },
        }));
        return !isFavorite;
      },

      recordWatched: (playlistId, url) =>
        set((state) => {
          const entries = (state.history[playlistId] ?? []).filter((entry) => entry.url !== url);
          return {
            history: { ...state.history, [playlistId]: [{ url, at: Date.now() }, ...entries].slice(0, HISTORY_LIMIT) },
          };
        }),

      clearHistory: (playlistId) => set((state) => ({ history: { ...state.history, [playlistId]: [] } })),

      updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

      reset: () => set(initialState()),
    }),
    {
      name: 'iptv:library',
      version: 1,
      partialize: ({ playlists, activePlaylistId, favorites, history, settings }) => ({
        playlists,
        activePlaylistId,
        favorites,
        history,
        settings,
      }),
      // Settings added in later versions must keep their defaults.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<LibraryState>;
        return { ...current, ...saved, settings: { ...current.settings, ...saved.settings } };
      },
    },
  ),
);
