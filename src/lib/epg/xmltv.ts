import { fold } from '../text';

export interface Programme {
  /** Epoch milliseconds. */
  start: number;
  stop: number;
  title: string;
  desc?: string;
  category?: string;
}

export interface GuideData {
  /** Programmes per guide channel id (lower case), sorted by start time. */
  programmes: Record<string, Programme[]>;
  /** channelKey(display name) → guide channel id, for playlist entries whose tvg-id doesn't match. */
  aliases: Record<string, string>;
}

export interface GuideFilter {
  /** Lower-cased tvg-ids used by the playlist. */
  ids: string[];
  /** channelKey() of the playlist's channel names. */
  names: string[];
  /** Keep programmes overlapping this window (epoch ms). */
  from: number;
  to: number;
}

const DESC_LIMIT = 400;
/** A single element never gets this big; anything larger means the input isn't XMLTV. */
const MAX_PENDING = 2 * 1024 * 1024;

const ATTRIBUTES = {
  id: /\sid\s*=\s*"([^"]*)"|\sid\s*=\s*'([^']*)'/,
  channel: /\schannel\s*=\s*"([^"]*)"|\schannel\s*=\s*'([^']*)'/,
  start: /\sstart\s*=\s*"([^"]*)"|\sstart\s*=\s*'([^']*)'/,
  stop: /\sstop\s*=\s*"([^"]*)"|\sstop\s*=\s*'([^']*)'/,
};
const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title>/;
const DESC = /<desc\b[^>]*>([\s\S]*?)<\/desc>/;
const CATEGORY = /<category\b[^>]*>([\s\S]*?)<\/category>/;
const DISPLAY_NAME = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g;
const ENTITY = /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Normalized channel name for matching playlist entries to guide channels:
 * "TR: TRT 1 HD" and "TRT 1" both become "trt1".
 */
export function channelKey(name: string): string {
  return fold(name)
    .replace(/^\s*[a-z]{2,3}\s*[:|]\s*/, '')
    .replace(/\b(uhd|fhd|hd|sd|4k|hevc|h265|backup)\b/g, '')
    .replace(/[^a-z\d]/g, '');
}

/** XMLTV time: "20261001203000 +0300" (offset optional, UTC when missing). */
export function parseXmltvTime(value: string | undefined): number | null {
  const match = value && /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', sign, offsetHours = '0', offsetMinutes = '0'] = match;
  const utc = Date.UTC(+year!, +month! - 1, +day!, +hour!, +minute!, +second);
  const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60_000;
  return sign === '-' ? utc + offset : utc - offset;
}

/**
 * Streaming XMLTV reader. Guides for big providers are hundreds of megabytes, so text is fed
 * in chunks and only programmes of the playlist's channels inside the time window are kept.
 */
export class GuideCollector {
  /** Whether anything XMLTV-like was seen (to reject HTML error pages and the like). */
  recognized = false;
  count = 0;
  private buffer = '';
  private readonly ids: Set<string>;
  private readonly names: Set<string>;
  private readonly from: number;
  private readonly to: number;
  private readonly data: GuideData = { programmes: {}, aliases: {} };

  constructor(filter: GuideFilter) {
    this.ids = new Set(filter.ids);
    this.names = new Set(filter.names);
    this.from = filter.from;
    this.to = filter.to;
  }

  push(chunk: string): void {
    const buffer = this.buffer + chunk;
    let pos = 0;
    let channelAt = buffer.indexOf('<channel', pos);
    let programmeAt = buffer.indexOf('<programme', pos);

    for (;;) {
      const isChannel = channelAt !== -1 && (programmeAt === -1 || channelAt < programmeAt);
      const at = isChannel ? channelAt : programmeAt;
      if (at === -1) break;
      const closing = isChannel ? '</channel>' : '</programme>';
      const end = buffer.indexOf(closing, at);
      if (end === -1) {
        pos = at; // incomplete element: wait for the next chunk
        break;
      }
      const element = buffer.slice(at, end + closing.length);
      pos = end + closing.length;
      this.recognized = true;
      if (isChannel) {
        this.readChannel(element);
        channelAt = buffer.indexOf('<channel', pos);
        if (programmeAt !== -1 && programmeAt < pos) programmeAt = buffer.indexOf('<programme', pos);
      } else {
        this.readProgramme(element);
        programmeAt = buffer.indexOf('<programme', pos);
        if (channelAt !== -1 && channelAt < pos) channelAt = buffer.indexOf('<channel', pos);
      }
    }

    // Keep the unfinished tail, including a tag name split across chunks.
    const incomplete = channelAt !== -1 || programmeAt !== -1;
    this.buffer = incomplete ? buffer.slice(pos) : buffer.slice(Math.max(pos, buffer.length - 16));
    if (this.buffer.length > MAX_PENDING) this.buffer = '';
    if (!this.recognized && buffer.includes('<tv')) this.recognized = true;
  }

  finish(): GuideData {
    for (const list of Object.values(this.data.programmes)) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 0; i < list.length; i++) {
        const programme = list[i]!;
        // Missing stop times end where the next programme begins.
        if (Number.isNaN(programme.stop)) programme.stop = list[i + 1]?.start ?? programme.start + 3_600_000;
      }
    }
    return this.data;
  }

  private readChannel(xml: string): void {
    const id = attribute(xml.slice(0, xml.indexOf('>') + 1), 'id')?.toLowerCase();
    if (!id) return;
    for (const match of xml.matchAll(DISPLAY_NAME)) {
      const key = channelKey(decode(match[1] ?? ''));
      if (key && this.names.has(key) && !this.data.aliases[key]) {
        this.data.aliases[key] = id;
        this.ids.add(id);
      }
    }
  }

  private readProgramme(xml: string): void {
    const head = xml.slice(0, xml.indexOf('>') + 1);
    const channel = attribute(head, 'channel')?.toLowerCase();
    if (!channel || !this.ids.has(channel)) return;

    const start = parseXmltvTime(attribute(head, 'start'));
    if (start === null) return;
    const stop = parseXmltvTime(attribute(head, 'stop')) ?? Number.NaN;
    if (start > this.to || (!Number.isNaN(stop) && stop < this.from)) return;

    const title = decode(TITLE.exec(xml)?.[1] ?? '');
    if (!title) return;
    const programme: Programme = { start, stop, title };
    const desc = decode(DESC.exec(xml)?.[1] ?? '');
    if (desc) programme.desc = desc.length > DESC_LIMIT ? `${desc.slice(0, DESC_LIMIT).trimEnd()}…` : desc;
    const category = decode(CATEGORY.exec(xml)?.[1] ?? '');
    if (category) programme.category = category;

    (this.data.programmes[channel] ??= []).push(programme);
    this.count++;
  }
}

function attribute(xml: string, name: keyof typeof ATTRIBUTES): string | undefined {
  const match = ATTRIBUTES[name].exec(xml);
  return match ? (match[1] ?? match[2]) : undefined;
}

function decode(value: string): string {
  let text = value.trim();
  if (text.startsWith('<![CDATA[')) text = text.slice(9, text.endsWith(']]>') ? -3 : undefined);
  return text
    .replace(ENTITY, (whole, entity: string) => {
      if (entity[0] !== '#') return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
