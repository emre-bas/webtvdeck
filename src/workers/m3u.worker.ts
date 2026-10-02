import { M3UError, parseM3U, type ParseOptions } from '../lib/m3u';

export interface ParseRequest {
  text: string;
  options: ParseOptions;
}

addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  try {
    postMessage({ ok: true, result: parseM3U(event.data.text, event.data.options) });
  } catch (error) {
    postMessage({
      ok: false,
      code: error instanceof M3UError ? error.code : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
