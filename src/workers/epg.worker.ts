import { GuideCollector, type GuideData, type GuideFilter } from '../lib/epg/xmltv';

export interface GuideRequest {
  /** Candidate URLs, tried in order (direct first, then through the proxy). */
  urls: string[];
  filter: GuideFilter;
}

export type GuideReply =
  | { type: 'progress'; bytes: number }
  | { type: 'done'; data: GuideData; programmes: number }
  | { type: 'error'; reason: 'network' | 'http' | 'format'; status?: number };

const PROGRESS_INTERVAL_MS = 250;

addEventListener('message', (event: MessageEvent<GuideRequest>) => {
  void run(event.data).then((reply) => postMessage(reply));
});

async function run({ urls, filter }: GuideRequest): Promise<GuideReply> {
  let failure: GuideReply = { type: 'error', reason: 'network' };
  for (const url of urls) {
    let response: Response;
    try {
      response = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch {
      failure = { type: 'error', reason: 'network' };
      continue;
    }
    if (!response.ok || !response.body) {
      failure = { type: 'error', reason: 'http', status: response.status };
      continue;
    }

    const collector = new GuideCollector(filter);
    try {
      await read(response.body, collector);
    } catch {
      return { type: 'error', reason: 'format' };
    }
    if (!collector.recognized) return { type: 'error', reason: 'format' };
    return { type: 'done', data: collector.finish(), programmes: collector.count };
  }
  return failure;
}

/** Streams the body through gunzip (for .xml.gz files) and a text decoder into the collector. */
async function read(body: ReadableStream<Uint8Array<ArrayBuffer>>, collector: GuideCollector): Promise<void> {
  const reader = body.getReader();
  const first = await reader.read();
  if (first.done) return;

  let bytes = 0;
  let reported = 0;
  // Typed as BufferSource: that's what DecompressionStream and TextDecoderStream accept.
  const counted = new ReadableStream<BufferSource>({
    start(controller) {
      bytes += first.value.byteLength;
      controller.enqueue(first.value);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      bytes += value.byteLength;
      controller.enqueue(value);
      const now = performance.now();
      if (now - reported > PROGRESS_INTERVAL_MS) {
        reported = now;
        postMessage({ type: 'progress', bytes } satisfies GuideReply);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  // Servers rarely label .gz guides properly, so check the gzip magic number instead.
  const gzip = first.value[0] === 0x1f && first.value[1] === 0x8b;
  const binary: ReadableStream<BufferSource> = gzip ? counted.pipeThrough(new DecompressionStream('gzip')) : counted;
  const text = binary.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await text.read();
    if (done) break;
    collector.push(value);
  }
}
