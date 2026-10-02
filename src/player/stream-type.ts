import type { EngineKind } from './types';

const HLS_MIME = 'application/vnd.apple.mpegurl';
const TS_MIME = 'video/mp2t';
const FILE_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'mp3', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'wav',
]);

export function extensionOf(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? '';
  }
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Engines to try, in order, for a stream URL. IPTV URLs often have no extension at all
 * (Xtream Codes: http://host/user/pass/123), so unknown URLs go through every engine,
 * cheapest failure first: mpegts.js rejects a non-TS body after a few bytes, while hls.js
 * would download a whole file before deciding it isn't a playlist.
 */
export function engineChain(url: string, canPlayNatively: (mime: string) => boolean): EngineKind[] {
  const extension = extensionOf(url);
  if (extension === 'm3u8' || extension === 'm3u' || /[/?&=]m3u8\b|\.m3u8\b/i.test(url)) {
    return canPlayNatively(HLS_MIME) ? ['hls', 'native'] : ['hls'];
  }
  if (['ts', 'mts', 'm2ts', 'flv'].includes(extension) || /[?&](output|type|format)=(ts|mpegts)\b/i.test(url)) {
    return canPlayNatively(TS_MIME) ? ['mpegts', 'native'] : ['mpegts'];
  }
  if (FILE_EXTENSIONS.has(extension)) return ['native'];
  return ['mpegts', 'native', 'hls'];
}
