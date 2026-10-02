import type { GuideReply, GuideRequest } from '../../workers/epg.worker';
import { isMixedContent, knownToNeedProxy, proxied, type ProxyConfig } from '../proxy';
import type { GuideData, GuideFilter } from './xmltv';

export type GuideFailure = 'network' | 'http' | 'format' | 'mixed-content' | 'unsupported';

export class GuideError extends Error {
  readonly reason: GuideFailure;
  readonly status?: number;

  constructor(reason: GuideFailure, status?: number) {
    super(status ? `Guide download failed (${status})` : `Guide download failed (${reason})`);
    this.name = 'GuideError';
    this.reason = reason;
    this.status = status;
  }
}

/** Downloads and parses an XMLTV guide in a worker (guides can be hundreds of megabytes). */
export function downloadGuide(
  url: string,
  filter: GuideFilter,
  proxy: ProxyConfig,
  onProgress?: (bytes: number) => void,
): Promise<{ data: GuideData; programmes: number }> {
  const urls = candidates(url, proxy);
  if (!urls.length) return Promise.reject(new GuideError('mixed-content'));

  let worker: Worker;
  try {
    worker = new Worker(new URL('../../workers/epg.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return Promise.reject(new GuideError('unsupported'));
  }

  return new Promise((resolve, reject) => {
    worker.addEventListener('message', ({ data }: MessageEvent<GuideReply>) => {
      if (data.type === 'progress') {
        onProgress?.(data.bytes);
        return;
      }
      worker.terminate();
      if (data.type === 'done') resolve({ data: data.data, programmes: data.programmes });
      else reject(new GuideError(data.reason, data.status));
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new GuideError('unsupported'));
    });
    worker.postMessage({ urls, filter } satisfies GuideRequest);
  });
}

/** Same routing rules as channel lists: direct when possible, the proxy as a fallback. */
function candidates(url: string, proxy: ProxyConfig): string[] {
  const viaProxy = proxy.endpoint ? proxied(proxy.endpoint, url, { raw: true, userAgent: proxy.userAgent }) : null;
  const needsProxy = proxy.mode === 'always' || Boolean(proxy.userAgent) || knownToNeedProxy(url);
  if (isMixedContent(url)) return viaProxy ? [viaProxy] : [];
  if (viaProxy) return needsProxy ? [viaProxy] : [url, viaProxy];
  return [url];
}
