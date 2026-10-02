import { isMixedContent, knownToNeedProxy, proxied, rememberNeedsProxy, type ProxyConfig } from './proxy';

export type FetchFailure = 'network' | 'http' | 'mixed-content';

export class FetchTextError extends Error {
  readonly reason: FetchFailure;
  readonly status?: number;
  /** Whether the request went through the proxy (so suggesting one would not help). */
  readonly viaProxy: boolean;

  constructor(reason: FetchFailure, options: { status?: number; viaProxy?: boolean } = {}) {
    super(options.status ? `HTTP ${options.status}` : reason);
    this.name = 'FetchTextError';
    this.reason = reason;
    this.status = options.status;
    this.viaProxy = options.viaProxy ?? false;
  }
}

export interface FetchTextOptions {
  onProgress?: (loaded: number, total?: number) => void;
  signal?: AbortSignal;
  /** Encoding to assume when the file isn't valid UTF-8. */
  fallbackEncoding?: string;
}

export interface FetchTextResult {
  text: string;
  /** URL after redirects; relative entries in the file resolve against it. */
  finalUrl: string;
}

/**
 * Downloads a text resource (a channel list or guide): directly when the server allows it,
 * through the proxy when it doesn't (blocked by CORS, plain HTTP on an HTTPS page, or the
 * 403 some providers send to browser requests).
 */
export async function fetchText(url: string, proxy: ProxyConfig, options: FetchTextOptions = {}): Promise<FetchTextResult> {
  const { endpoint } = proxy;
  const needsProxy = proxy.mode === 'always' || isMixedContent(url) || Boolean(proxy.userAgent) || knownToNeedProxy(url);

  if (endpoint === null || !needsProxy) {
    if (isMixedContent(url)) throw new FetchTextError('mixed-content');
    try {
      return await download(url, options, false);
    } catch (error) {
      const retry = error instanceof FetchTextError && (error.reason === 'network' || error.status === 403);
      if (!retry || endpoint === null) throw error;
      rememberNeedsProxy(url);
    }
  }
  return download(proxied(endpoint, url, { raw: true, userAgent: proxy.userAgent }), options, true);
}

async function download(url: string, options: FetchTextOptions, viaProxy: boolean): Promise<FetchTextResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: options.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new FetchTextError('network', { viaProxy });
  }
  if (!response.ok) {
    // The proxy answers 502 when it can't reach the server at all.
    if (viaProxy && response.status === 502) throw new FetchTextError('network', { viaProxy });
    throw new FetchTextError('http', { status: response.status, viaProxy });
  }

  const total = Number(response.headers.get('content-length')) || undefined;
  const bytes = await readBody(response, (loaded) => options.onProgress?.(loaded, total));
  return {
    text: decodeText(bytes, options.fallbackEncoding),
    finalUrl: response.headers.get('x-final-url') ?? (response.url || url),
  };
}

async function readBody(response: Response, onProgress: (loaded: number) => void): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** UTF-8 (with or without BOM), UTF-16 with BOM, otherwise a legacy single-byte encoding. */
export function decodeText(bytes: Uint8Array, fallbackEncoding = 'windows-1252'): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder(fallbackEncoding).decode(bytes);
  }
}
