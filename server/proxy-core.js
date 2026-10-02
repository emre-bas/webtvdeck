// @ts-check
/**
 * Stream proxy for IPTV playback.
 *
 * Browsers can't play most IPTV streams directly: providers rarely send CORS headers, often
 * serve plain HTTP (blocked as mixed content on HTTPS pages) and some insist on a User-Agent
 * or Referer that page scripts aren't allowed to set. This handler relays those requests and
 * rewrites HLS playlists so every nested URI (variants, segments, keys) goes through the
 * proxy as well.
 *
 * Only web-standard Request/Response/fetch are used, so the same code runs on Node (see
 * node-proxy.js), Deno, Bun or an edge worker.
 *
 *   GET <mount>?url=<target>[&ua=<user-agent>][&ref=<referrer>][&raw=1]
 *   GET <mount>/health
 *
 * raw=1 disables playlist rewriting; the app uses it to download channel lists (which are
 * M3U files too).
 */

const SERVICE = 'iptv-stream-proxy';
const PROXY_PARAMS = new Set(['url', 'ua', 'ref', 'raw']);
const FORWARDED_HEADERS = ['content-type', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control'];
const EXTM3U = '#EXTM3U';
/** HLS playlists are small; anything larger that starts with #EXTM3U is streamed untouched. */
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;

/**
 * Private LAN addresses stay reachable on purpose (local IPTV servers such as TVHeadend are a
 * common setup). Cloud metadata endpoints are not: they can leak credentials when the proxy
 * runs on a VPS.
 */
const BLOCKED_HOSTS = new Set(['169.254.169.254', '[fd00:ec2::254]', 'metadata.google.internal']);

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleProxyRequest(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405, 'method_not_allowed');

  const self = new URL(request.url);
  if (self.pathname.endsWith('/health')) return jsonResponse({ service: SERVICE, version: 1 });

  const target = resolveTarget(self.searchParams);
  if ('error' in target) return errorResponse(target.status, target.error);

  /** @type {Record<string, string>} */
  const forward = {};
  for (const key of ['ua', 'ref']) {
    const value = self.searchParams.get(key);
    if (value) forward[key] = value;
  }

  let upstream;
  try {
    upstream = await fetch(target.url, {
      method: request.method,
      headers: upstreamHeaders(request, forward),
      redirect: 'follow',
      signal: request.signal,
    });
  } catch (error) {
    return errorResponse(502, 'upstream_unreachable', describeError(error));
  }

  const finalUrl = upstream.url || target.url.href;
  const headers = corsHeaders();
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-final-url', finalUrl);

  const body = upstream.body;
  if (!body || request.method === 'HEAD') return new Response(null, { status: upstream.status, headers });

  // fetch() transparently decompresses, so the upstream length is only valid for identity bodies.
  const encoding = upstream.headers.get('content-encoding');
  const length = upstream.headers.get('content-length');
  if (length && (!encoding || encoding === 'identity')) headers.set('content-length', length);

  if (self.searchParams.has('raw') || !upstream.ok) {
    return new Response(body, { status: upstream.status, headers });
  }

  // HLS playlists turn up under all kinds of URLs and content types, so sniff the body: only
  // responses starting with #EXTM3U are buffered and rewritten, everything else is streamed.
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  while (size < 32) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (!startsWithExtM3u(concat(chunks, size))) {
    return new Response(replay(chunks, reader), { status: upstream.status, headers });
  }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > MAX_PLAYLIST_BYTES) return new Response(replay(chunks, reader), { status: upstream.status, headers });
  }

  const playlist = rewritePlaylist(new TextDecoder().decode(concat(chunks, size)), finalUrl, forward);
  headers.set('content-type', 'application/vnd.apple.mpegurl');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  headers.delete('content-range');
  headers.delete('accept-ranges');
  return new Response(playlist, { status: upstream.status, headers });
}

/**
 * Points every URI in an HLS playlist back at the proxy. References are written relative to
 * the proxy itself ("?url=…"), so the output works wherever the proxy is mounted.
 * @param {string} text
 * @param {string} baseUrl URL the playlist was loaded from (after redirects)
 * @param {Record<string, string>} [forward] proxy params that nested requests should keep (ua, ref)
 */
export function rewritePlaylist(text, baseUrl, forward = {}) {
  /** @param {string} uri */
  const proxied = (uri) => {
    let absolute;
    try {
      absolute = new URL(uri, baseUrl);
    } catch {
      return uri;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return uri;
    return `?${new URLSearchParams({ url: absolute.href, ...forward })}`;
  };

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) return line.replace(/URI="([^"]*)"/g, (_, uri) => `URI="${proxied(uri)}"`);
      return proxied(trimmed);
    })
    .join('\n');
}

/**
 * @param {URLSearchParams} params
 * @returns {{ url: URL } | { error: string, status: number }}
 */
function resolveTarget(params) {
  const raw = params.get('url');
  if (!raw) return { error: 'missing_url', status: 400 };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'invalid_url', status: 400 };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'unsupported_protocol', status: 400 };

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.startsWith('169.254.')) return { error: 'forbidden_host', status: 403 };

  // Parameters a player appends to a proxied URL (e.g. LL-HLS _HLS_msn) belong to the target.
  // Concatenate instead of using searchParams so the target's own query isn't re-encoded.
  const extra = [...params].filter(([key]) => !PROXY_PARAMS.has(key));
  if (extra.length) {
    const suffix = extra.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
    url.search = url.search ? `${url.search}&${suffix}` : `?${suffix}`;
  }
  return { url };
}

/**
 * @param {Request} request
 * @param {Record<string, string>} forward
 */
function upstreamHeaders(request, forward) {
  const headers = new Headers({ accept: '*/*' });
  const userAgent = forward.ua || request.headers.get('user-agent');
  if (userAgent) headers.set('user-agent', userAgent);
  if (forward.ref) headers.set('referer', forward.ref);
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  return headers;
}

/** @param {Uint8Array} bytes */
function startsWithExtM3u(bytes) {
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0; // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  for (let j = 0; j < EXTM3U.length; j++) {
    if (bytes[i + j] !== EXTM3U.charCodeAt(j)) return false;
  }
  return true;
}

/**
 * @param {Uint8Array[]} chunks
 * @param {number} size
 */
function concat(chunks, size) {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Re-emits the chunks consumed while sniffing, then the rest of the upstream body.
 * @param {Uint8Array[]} chunks
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 */
function replay(chunks, reader) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      const buffered = chunks[index];
      if (buffered) {
        index++;
        controller.enqueue(buffered);
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** @param {Headers | Record<string, string>} [extra] */
function corsHeaders(extra) {
  const headers = new Headers(extra);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  headers.set('access-control-allow-headers', 'range, content-type');
  headers.set('access-control-expose-headers', 'content-length, content-range, content-type, x-final-url');
  headers.set('access-control-max-age', '86400');
  return headers;
}

/**
 * @param {unknown} body
 * @param {number} [status]
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders({ 'content-type': 'application/json', 'cache-control': 'no-store' }),
  });
}

/**
 * @param {number} status
 * @param {string} error
 * @param {string} [detail]
 */
function errorResponse(status, error, detail) {
  return jsonResponse({ error, detail }, status);
}

/** @param {unknown} error */
function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = /** @type {{ code?: unknown } | undefined} */ (error.cause);
  return typeof cause?.code === 'string' ? cause.code : error.message;
}
