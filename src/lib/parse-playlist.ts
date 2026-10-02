import { M3UError, parseM3U, type M3UErrorCode, type ParseOptions, type ParseResult } from './m3u';
import type { ParseRequest } from '../workers/m3u.worker';

type WorkerReply = { ok: true; result: ParseResult } | { ok: false; code?: M3UErrorCode; message: string };

/** Parses in a worker so big lists don't freeze the UI (TV boxes are slow). */
export function parsePlaylist(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('../workers/m3u.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve().then(() => parseM3U(text, options));
  }

  return new Promise((resolve, reject) => {
    worker.addEventListener('message', ({ data }: MessageEvent<WorkerReply>) => {
      worker.terminate();
      if (data.ok) resolve(data.result);
      else reject(data.code ? new M3UError(data.code) : new Error(data.message));
    });
    worker.addEventListener('error', (event) => {
      // The worker couldn't start (old browser, strict CSP); parse on the main thread instead.
      event.preventDefault();
      worker.terminate();
      try {
        resolve(parseM3U(text, options));
      } catch (error) {
        reject(error);
      }
    });
    worker.postMessage({ text, options } satisfies ParseRequest);
  });
}
