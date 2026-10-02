import { create } from 'zustand';
import { fold } from '../lib/text';
import type { Channel } from '../lib/types';

export type DrawerTab = 'channels' | 'favorites' | 'history' | 'playlists' | 'settings';

export interface GroupInfo {
  /** Empty string collects channels without a group. */
  name: string;
  count: number;
}

export interface ChannelIndex {
  groups: GroupInfo[];
  byGroup: Map<string, Channel[]>;
  byUrl: Map<string, Channel>;
  byNumber: Map<number, Channel>;
  /** Folded names for search, parallel to the channel array. */
  searchKeys: string[];
}

export interface PlayRequest {
  channel: Channel;
  /** What up/down zapping walks through: the list the channel was picked from. */
  zapList: Channel[];
  /** Increases with every request, so replaying the same channel still reloads it. */
  seq: number;
  forceProxy?: boolean;
}

interface SessionState {
  playlistId: string | null;
  loadState: 'idle' | 'loading' | 'ready' | 'missing';
  channels: Channel[];
  index: ChannelIndex;
  request: PlayRequest | null;
  /** Channel watched before the current one ("recall"). */
  previous: Channel | null;
  drawerOpen: boolean;
  drawerTab: DrawerTab;
  /** Group shown in the channel list; null shows all channels. */
  group: string | null;
  /** Whether the server hosting the app also runs the stream proxy. */
  builtInProxy: boolean;
  /** Digits typed on the keyboard/remote to jump to a channel number. */
  digits: string;
  /** Programme info panel above the control bar. */
  infoOpen: boolean;
}

export const EMPTY_INDEX: ChannelIndex = {
  groups: [],
  byGroup: new Map(),
  byUrl: new Map(),
  byNumber: new Map(),
  searchKeys: [],
};

/** Runtime state of the open playlist and the UI around the player (not persisted). */
export const useSession = create<SessionState>()(() => ({
  playlistId: null,
  loadState: 'idle',
  channels: [],
  index: EMPTY_INDEX,
  request: null,
  previous: null,
  drawerOpen: false,
  drawerTab: 'channels',
  group: null,
  builtInProxy: false,
  digits: '',
  infoOpen: false,
}));

export function buildIndex(channels: Channel[]): ChannelIndex {
  const byGroup = new Map<string, Channel[]>();
  const byUrl = new Map<string, Channel>();
  const byNumber = new Map<number, Channel>();
  const searchKeys: string[] = [];

  for (const channel of channels) {
    const group = channel.group ?? '';
    const members = byGroup.get(group);
    if (members) members.push(channel);
    else byGroup.set(group, [channel]);
    if (!byUrl.has(channel.url)) byUrl.set(channel.url, channel);
    if (!byNumber.has(channel.num)) byNumber.set(channel.num, channel);
    searchKeys.push(fold(channel.name));
  }

  const groups = [...byGroup].map(([name, members]) => ({ name, count: members.length }));
  // Ungrouped channels go last.
  groups.sort((a, b) => Number(a.name === '') - Number(b.name === ''));
  return { groups, byGroup, byUrl, byNumber, searchKeys };
}
