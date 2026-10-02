import { t } from '../i18n';
import { loadChannels } from '../lib/db';
import type { Channel } from '../lib/types';
import { openGuide } from './guide';
import { useLibrary } from './library';
import { whenProxyKnown } from './proxy';
import { buildIndex, EMPTY_INDEX, useSession, type DrawerTab } from './session';
import { toast } from './toasts';

let requestSeq = 0;
let digitTimer = 0;
let historyTimer = 0;

/** Channels only count as watched after a few seconds, so zapping past them doesn't flood the history. */
const WATCHED_AFTER_MS = 5000;

/** Loads a playlist's channels and starts where the user left off. */
export async function openPlaylist(playlistId: string): Promise<void> {
  useSession.setState({
    playlistId,
    loadState: 'loading',
    channels: [],
    index: EMPTY_INDEX,
    request: null,
    previous: null,
    group: null,
    digits: '',
    infoOpen: false,
  });

  const [channels] = await Promise.all([loadChannels(playlistId).catch(() => null), whenProxyKnown()]);
  if (useSession.getState().playlistId !== playlistId) return;
  if (!channels) {
    useSession.setState({ loadState: 'missing', drawerOpen: false });
    return;
  }
  setChannels(channels);
  void openGuide(playlistId, channels);

  const { settings, history } = useLibrary.getState();
  const lastUrl = history[playlistId]?.[0]?.url;
  const last = lastUrl ? useSession.getState().index.byUrl.get(lastUrl) : undefined;
  if (settings.autoplayLast && last) {
    play(last);
    closeDrawer();
  } else {
    openDrawer('channels');
  }
}

export function setChannels(channels: Channel[]): void {
  const index = buildIndex(channels);
  useSession.setState((state) => ({
    channels,
    index,
    loadState: 'ready',
    group: state.group !== null && index.byGroup.has(state.group) ? state.group : null,
  }));
}

/**
 * Switches to a channel. `zapList` is the list it was picked from, so channel up/down keeps
 * walking that list (a group, the favorites, search results); by default it's the group.
 */
export function play(channel: Channel, options: { zapList?: Channel[]; forceProxy?: boolean } = {}): void {
  const { request, previous, index, channels, playlistId } = useSession.getState();
  const current = request?.channel;
  useSession.setState({
    request: {
      channel,
      zapList: options.zapList ?? index.byGroup.get(channel.group ?? '') ?? channels,
      seq: ++requestSeq,
      forceProxy: options.forceProxy,
    },
    previous: current && current.url !== channel.url ? current : previous,
  });

  window.clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => {
    const session = useSession.getState();
    if (playlistId && session.playlistId === playlistId && session.request?.channel.url === channel.url) {
      useLibrary.getState().recordWatched(playlistId, channel.url);
    }
  }, WATCHED_AFTER_MS);
}

/**
 * A channel picked from a list: the first press switches to it while the menu stays open for
 * browsing, pressing the playing channel again goes back to full screen (like a TV remote's
 * OK button). On phones the menu covers the video, so it closes right away.
 */
export function activateChannel(channel: Channel, zapList: Channel[]): void {
  const playing = useSession.getState().request?.channel.url === channel.url;
  if (!playing) play(channel, { zapList });
  if (playing || window.matchMedia('(max-width: 600px)').matches) closeDrawer();
}

export function zap(delta: number): void {
  const { request, channels } = useSession.getState();
  if (!request) {
    const first = channels[0];
    if (first) play(first);
    return;
  }
  const list = request.zapList.length ? request.zapList : channels;
  const position = list.indexOf(request.channel);
  const next = list[(Math.max(position, 0) + delta + list.length) % list.length];
  // A one-channel list would just restart the stream.
  if (next && next.url !== request.channel.url) play(next, { zapList: list });
}

export function recall(): void {
  const { previous } = useSession.getState();
  if (previous) play(previous);
}

export function retry(options: { forceProxy?: boolean } = {}): void {
  const { request } = useSession.getState();
  if (request) play(request.channel, { zapList: request.zapList, forceProxy: options.forceProxy });
}

export function openDrawer(tab?: DrawerTab): void {
  useSession.setState((state) => ({ drawerOpen: true, drawerTab: tab ?? state.drawerTab, infoOpen: false }));
}

/** The programme info panel above the control bar (the INFO button of a remote). */
export function toggleInfo(open = !useSession.getState().infoOpen): void {
  useSession.setState({ infoOpen: open });
}

export function closeDrawer(): void {
  useSession.setState({ drawerOpen: false });
}

export function selectGroup(group: string | null): void {
  useSession.setState({ group });
}

export function toggleFavorite(channel: Channel): void {
  const { playlistId } = useSession.getState();
  if (!playlistId) return;
  const added = useLibrary.getState().toggleFavorite(playlistId, channel.url);
  toast(t(added ? 'toast.favoriteAdded' : 'toast.favoriteRemoved'), { tone: added ? 'success' : 'info', duration: 2000 });
}

/** Number keys: collect digits like a TV remote and switch after a short pause. */
export function typeDigit(digit: string): void {
  const digits = (useSession.getState().digits + digit).slice(-4);
  useSession.setState({ digits });
  window.clearTimeout(digitTimer);
  digitTimer = window.setTimeout(commitDigits, 1500);
}

/** Returns false when no digits were pending. */
export function commitDigits(): boolean {
  window.clearTimeout(digitTimer);
  const { digits, index } = useSession.getState();
  if (!digits) return false;
  useSession.setState({ digits: '' });
  const channel = index.byNumber.get(Number(digits));
  if (channel) play(channel);
  else toast(t('player.noChannelNumber', { num: digits }), { tone: 'warning', duration: 2500 });
  return true;
}
