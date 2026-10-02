import type { Channel } from './types';

export interface ParseOptions {
  /** Where the playlist was downloaded from; used to resolve relative stream URLs. */
  baseUrl?: string;
}

export interface ParseResult {
  channels: Channel[];
  /** XMLTV guide URLs announced in the #EXTM3U header. */
  epgUrls: string[];
  /** Entries dropped because browsers can't open their protocol (rtmp://, udp://, …). */
  unsupported: number;
}

export type M3UErrorCode = 'html' | 'empty' | 'not-m3u';

export class M3UError extends Error {
  readonly code: M3UErrorCode;

  constructor(code: M3UErrorCode) {
    super(`Invalid playlist (${code})`);
    this.name = 'M3UError';
    this.code = code;
  }
}

type Attributes = Record<string, string>;

interface ExtInf {
  attrs: Attributes;
  title: string;
}

const HASH = 35;
const COMMA = 44;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * Parses an extended M3U playlist as used by IPTV providers:
 *
 *   #EXTM3U url-tvg="http://…/guide.xml.gz"
 *   #EXTINF:-1 tvg-id="trt1.tr" tvg-logo="http://…" group-title="Ulusal",TRT 1 HD
 *   #EXTVLCOPT:http-user-agent=…
 *   http://…/stream.m3u8|Referer=http://…
 *
 * Tolerates the usual real-world mess: missing #EXTM3U, CRLF, BOM, commas inside quoted
 * attributes, unquoted values, #EXTGRP groups and Kodi-style "|Header=value" suffixes.
 */
export function parseM3U(input: string, options: ParseOptions = {}): ParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.trimStart().startsWith('<')) throw new M3UError('html');

  const channels: Channel[] = [];
  const epgUrls: string[] = [];
  let unsupported = 0;
  let recognized = false;
  let defaultShift: number | undefined;

  // Directives collected for the next URL line.
  let info: ExtInf | null = null;
  let extGroup: string | undefined;
  let vlcUserAgent: string | undefined;
  let vlcReferrer: string | undefined;

  let pos = 0;
  while (pos < text.length) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    const line = text.slice(pos, end).trim();
    pos = end + 1;
    if (!line) continue;

    if (line.charCodeAt(0) === HASH) {
      const tag = line.slice(0, 11).toUpperCase();
      if (tag.startsWith('#EXTINF:')) {
        info = parseExtInf(line.slice(8));
        recognized = true;
      } else if (tag.startsWith('#EXTGRP:')) {
        extGroup = line.slice(8).trim() || undefined;
      } else if (tag.startsWith('#EXTVLCOPT:')) {
        const [key, value] = splitOption(line.slice(11));
        if (key === 'http-user-agent') vlcUserAgent = value;
        else if (key === 'http-referrer' || key === 'http-referer') vlcReferrer = value;
      } else if (tag.startsWith('#EXTM3U')) {
        recognized = true;
        const { attrs } = parseAttributes(line, 7, false);
        for (const key of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
          for (const url of (attrs[key] ?? '').split(',')) {
            const trimmed = url.trim();
            if (isHttpUrl(trimmed) && !epgUrls.includes(trimmed)) epgUrls.push(trimmed);
          }
        }
        defaultShift = toShift(attrs['tvg-shift']);
      }
      continue;
    }

    const { url: rawUrl, headers } = splitPipeHeaders(line);
    const url = resolveStreamUrl(rawUrl, options.baseUrl);
    if (url) {
      channels.push(
        buildChannel(url, channels.length + 1, info, {
          group: extGroup,
          userAgent: headers['user-agent'] ?? vlcUserAgent,
          referrer: headers['referer'] ?? headers['referrer'] ?? vlcReferrer,
          defaultShift,
        }),
      );
    } else if (info || SCHEME.test(rawUrl)) {
      unsupported++;
    }
    info = null;
    extGroup = vlcUserAgent = vlcReferrer = undefined;
  }

  if (!channels.length) throw new M3UError(recognized ? 'empty' : 'not-m3u');
  return { channels, epgUrls, unsupported };
}

interface Extras {
  group?: string;
  userAgent?: string;
  referrer?: string;
  defaultShift?: number;
}

function buildChannel(url: string, position: number, info: ExtInf | null, extras: Extras): Channel {
  const attrs = info?.attrs ?? {};
  const chno = Number.parseInt(attrs['tvg-chno'] ?? '', 10);
  const channel: Channel = {
    url,
    name: info?.title || attrs['tvg-name'] || nameFromUrl(url),
    num: chno > 0 ? chno : position,
  };

  const logo = attrs['tvg-logo'] || attrs['logo'];
  if (logo && (isHttpUrl(logo) || logo.startsWith('data:image/'))) channel.logo = logo;

  const group = attrs['group-title'] || extras.group;
  if (group) channel.group = group;
  if (attrs['tvg-id']) channel.tvgId = attrs['tvg-id'];
  if (attrs['tvg-name']) channel.tvgName = attrs['tvg-name'];

  const shift = toShift(attrs['tvg-shift']) ?? extras.defaultShift;
  if (shift) channel.tvgShift = shift;
  if (attrs['radio'] === 'true') channel.radio = true;

  const userAgent = extras.userAgent || attrs['http-user-agent'] || attrs['user-agent'];
  if (userAgent) channel.userAgent = userAgent;
  const referrer = extras.referrer || attrs['http-referrer'] || attrs['http-referer'] || attrs['referrer'];
  if (referrer) channel.referrer = referrer;

  return channel;
}

/** `-1 tvg-id="x" group-title="A, B",Title, with commas` → attributes + title. */
function parseExtInf(value: string): ExtInf {
  let i = 0;
  // Skip the duration ("-1", "0", …).
  while (i < value.length && value.charCodeAt(i) !== COMMA && !isSpace(value.charCodeAt(i))) i++;
  const { attrs, end } = parseAttributes(value, i, true);
  return { attrs, title: value.slice(end).trim() };
}

/**
 * Reads `key="value"`, `key='value'` and `key=value` pairs starting at `start`. With
 * `stopAtTitle` the first comma outside quotes ends the attribute list (#EXTINF syntax).
 */
function parseAttributes(s: string, start: number, stopAtTitle: boolean): { attrs: Attributes; end: number } {
  const attrs: Attributes = {};
  const n = s.length;
  const isStop = (i: number) => stopAtTitle && s.charCodeAt(i) === COMMA;
  let i = start;

  while (i < n) {
    const c = s.charCodeAt(i);
    if (isStop(i)) return { attrs, end: i + 1 };
    if (isSpace(c) || c === COMMA) {
      i++;
      continue;
    }

    const keyStart = i;
    while (i < n && s[i] !== '=' && !isSpace(s.charCodeAt(i)) && !isStop(i)) i++;
    const key = s.slice(keyStart, i).toLowerCase();
    if (s[i] !== '=') continue; // bare word without a value

    i++;
    let value: string;
    const quote = s[i];
    if (quote === '"' || quote === "'") {
      let close = s.indexOf(quote, i + 1);
      if (close === -1) {
        // Unterminated quote: assume the value runs up to the title separator.
        const lastComma = stopAtTitle ? s.lastIndexOf(',') : -1;
        close = lastComma > i ? lastComma : n;
        value = s.slice(i + 1, close);
        i = close;
      } else {
        value = s.slice(i + 1, close);
        i = close + 1;
      }
    } else {
      const valueStart = i;
      while (i < n && !isSpace(s.charCodeAt(i)) && !isStop(i)) i++;
      value = s.slice(valueStart, i);
    }
    if (key) attrs[key] = value.trim();
  }
  return { attrs, end: n };
}

function splitOption(value: string): [string, string] {
  const eq = value.indexOf('=');
  if (eq === -1) return [value.trim().toLowerCase(), ''];
  return [value.slice(0, eq).trim().toLowerCase(), value.slice(eq + 1).trim()];
}

/** Kodi convention: `http://host/stream.m3u8|User-Agent=Foo&Referer=http%3A%2F%2Fbar`. */
function splitPipeHeaders(line: string): { url: string; headers: Record<string, string> } {
  const bar = line.indexOf('|');
  if (bar === -1) return { url: line, headers: {} };
  const headers: Record<string, string> = {};
  for (const pair of line.slice(bar + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    headers[safeDecode(pair.slice(0, eq)).trim().toLowerCase()] = safeDecode(pair.slice(eq + 1)).trim();
  }
  return { url: line.slice(0, bar).trim(), headers };
}

function resolveStreamUrl(raw: string, baseUrl: string | undefined): string | null {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (SCHEME.test(raw)) return null; // rtmp:, udp:, rtsp:, file:, …
  const base = baseUrl ?? (raw.startsWith('//') ? 'https:' : undefined);
  if (!base) return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function nameFromUrl(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const last = pathname.split('/').filter(Boolean).pop();
    return last ? safeDecode(last).replace(/\.[a-z\d]{2,5}$/i, '') : hostname;
  } catch {
    return url;
  }
}

function toShift(value: string | undefined): number | undefined {
  const shift = Number.parseFloat(value ?? '');
  return Number.isFinite(shift) && shift !== 0 ? shift : undefined;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
