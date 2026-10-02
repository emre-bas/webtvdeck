import type { Channel } from '../types';
import { channelKey, type GuideData, type Programme } from './xmltv';

export interface NowNext {
  current?: Programme;
  next?: Programme;
}

/** A channel's schedule: by tvg-id first, then by name for playlists without usable ids. */
export function scheduleFor(guide: GuideData | null, channel: Channel): Programme[] | undefined {
  if (!guide) return undefined;
  const id = channel.tvgId?.toLowerCase();
  const byId = id ? guide.programmes[id] : undefined;
  if (byId) return byId;
  const alias = guide.aliases[channelKey(channel.tvgName || channel.name)];
  return alias ? guide.programmes[alias] : undefined;
}

/** Programmes airing at `now` and right after, with the channel's tvg-shift applied. */
export function nowNext(schedule: Programme[] | undefined, now: number, shiftHours = 0): NowNext {
  if (!schedule?.length) return {};
  const shift = shiftHours * 3_600_000;
  const at = now - shift;

  // Last programme starting at or before `at`.
  let low = 0;
  let high = schedule.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (schedule[mid]!.start <= at) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const candidate = found >= 0 ? schedule[found] : undefined;
  const current = candidate && candidate.stop > at ? candidate : undefined;
  const next = schedule[found + 1];
  return { current: shifted(current, shift), next: shifted(next, shift) };
}

/** Upcoming programmes after the current one. */
export function upcoming(schedule: Programme[] | undefined, now: number, shiftHours = 0, limit = 6): Programme[] {
  if (!schedule?.length) return [];
  const shift = shiftHours * 3_600_000;
  const at = now - shift;
  const result: Programme[] = [];
  for (const programme of schedule) {
    if (programme.start <= at) continue;
    result.push(shifted(programme, shift)!);
    if (result.length === limit) break;
  }
  return result;
}

export function progressOf(programme: Programme, now: number): number {
  const length = programme.stop - programme.start;
  return length > 0 ? Math.min(1, Math.max(0, (now - programme.start) / length)) : 0;
}

function shifted(programme: Programme | undefined, shift: number): Programme | undefined {
  if (!programme || !shift) return programme;
  return { ...programme, start: programme.start + shift, stop: programme.stop + shift };
}
