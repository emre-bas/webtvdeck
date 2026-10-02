export type ProxyMode = 'auto' | 'always' | 'off';

export interface ProxyConfig {
  /** Proxy endpoint to route requests through, or null when none is available or enabled. */
  endpoint: string | null;
  mode: ProxyMode;
  /** User-Agent applied to proxied requests; empty keeps the browser's. */
  userAgent: string;
}

export interface ProxyOptions {
  userAgent?: string;
  referrer?: string;
  /** Don't rewrite the response (for downloading channel lists). */
  raw?: boolean;
}

/** Served by `npm run dev`, `npm run preview` and `npm start` (see server/). */
export const BUILT_IN_PROXY = `${import.meta.env.BASE_URL}proxy`;

export async function detectBuiltInProxy(): Promise<boolean> {
  try {
    const response = await fetch(`${BUILT_IN_PROXY}/health`, { cache: 'no-store' });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && (body as { service?: unknown }).service === 'iptv-stream-proxy';
  } catch {
    return false;
  }
}

export function proxied(endpoint: string, target: string, options: ProxyOptions = {}): string {
  const url = new URL(endpoint, window.location.href);
  url.searchParams.set('url', target);
  if (options.userAgent) url.searchParams.set('ua', options.userAgent);
  if (options.referrer) url.searchParams.set('ref', options.referrer);
  if (options.raw) url.searchParams.set('raw', '1');
  return url.href;
}

/** HTTPS pages can't load plain-HTTP media or playlists; they have to go through a proxy. */
export function isMixedContent(url: string): boolean {
  return window.location.protocol === 'https:' && /^http:/i.test(url);
}

/**
 * The https:// address of a plain-HTTP URL, the only way to reach it from an HTTPS page without
 * a proxy (many servers answer on both). Null for a custom port or an IP address: those
 * practically never serve TLS, so trying would only delay the error.
 */
export function httpsTwin(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' || parsed.port || /^[\d.]+$|^\[/.test(parsed.hostname)) return null;
  parsed.protocol = 'https:';
  return parsed.href;
}

/**
 * Servers that refused direct browser access. All channels of a provider usually share a
 * host, so later requests go straight through the proxy: zapping gets faster and
 * single-connection accounts don't see a doomed extra connection first. Kept across
 * reloads so that the first channel after startup doesn't pay for it either.
 */
const STORAGE_KEY = 'iptv:proxied-origins';
const proxiedOrigins = new Set<string>(readStoredOrigins());

function readStoredOrigins(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((origin): origin is string => typeof origin === 'string') : [];
  } catch {
    return [];
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function rememberNeedsProxy(url: string): void {
  const origin = originOf(url);
  if (!origin || proxiedOrigins.has(origin)) return;
  proxiedOrigins.add(origin);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...proxiedOrigins].slice(-50)));
  } catch {
    // Storage unavailable (private mode); the in-memory set still helps this session.
  }
}

export function forgetProxiedOrigins(): void {
  proxiedOrigins.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

export function knownToNeedProxy(url: string): boolean {
  const origin = originOf(url);
  return origin !== null && proxiedOrigins.has(origin);
}
