// @ts-check
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleProxyRequest, rewritePlaylist } from './proxy-core.js';

describe('rewritePlaylist', () => {
  it('routes variants, segments and keys through the proxy', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/k1.bin"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",URI="audio/tr.m3u8"',
      '#EXTINF:6.0,',
      'seg-1.ts',
      'https://cdn.example/abs/seg-2.ts?token=a%2Fb',
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fairplay-key"',
    ].join('\n');

    const lines = rewritePlaylist(playlist, 'http://origin.example/live/index.m3u8', { ua: 'VLC/3' }).split('\n');
    const target = (line = '') => {
      const query = line.match(/\?([^"]+)/)?.[1] ?? '';
      return Object.fromEntries(new URLSearchParams(query));
    };

    expect(target(lines[1])).toEqual({ url: 'http://origin.example/live/keys/k1.bin', ua: 'VLC/3' });
    expect(target(lines[2])).toEqual({ url: 'http://origin.example/live/audio/tr.m3u8', ua: 'VLC/3' });
    expect(lines[3]).toBe('#EXTINF:6.0,');
    expect(target(lines[4])).toEqual({ url: 'http://origin.example/live/seg-1.ts', ua: 'VLC/3' });
    expect(target(lines[5])).toEqual({ url: 'https://cdn.example/abs/seg-2.ts?token=a%2Fb', ua: 'VLC/3' });
    expect(lines[6]).toBe('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fairplay-key"');
  });
});

describe('handleProxyRequest', () => {
  /** @type {http.Server} */
  let server;
  let origin = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      switch (req.url) {
        case '/redirect':
          res.writeHead(302, { location: '/live/index.m3u8' }).end();
          return;
        case '/live/index.m3u8':
          // Deliberately generic content type: detection must rely on the body.
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg.ts\n');
          return;
        case '/seg.ts': {
          const bytes = Buffer.alloc(188 * 4, 0x47);
          res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': bytes.length }).end(bytes);
          return;
        }
        case '/list.m3u':
          res.writeHead(200, { 'content-type': 'audio/x-mpegurl' }).end('#EXTM3U\n#EXTINF:-1,A\nhttp://x/a.m3u8\n');
          return;
        case '/gzip': {
          const body = gzipSync('#EXTM3U\n#EXTINF:-1,Zipped\nhttp://x/z.ts\n');
          res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': body.length }).end(body);
          return;
        }
        case '/echo':
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ua: req.headers['user-agent'], ref: req.headers.referer, range: req.headers.range }));
          return;
        default:
          res.writeHead(404, { 'content-type': 'text/plain' }).end('nope');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = /** @type {import('node:net').AddressInfo} */ (server.address());
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  /**
   * @param {string} path
   * @param {string} [extra]
   * @param {Record<string, string>} [headers]
   */
  const viaProxy = (path, extra = '', headers) =>
    handleProxyRequest(
      new Request(`http://proxy.test/proxy?url=${encodeURIComponent(origin + path)}${extra}`, { headers }),
    );

  it('answers health checks', async () => {
    const response = await handleProxyRequest(new Request('http://proxy.test/proxy/health'));
    expect(await response.json()).toEqual({ service: 'iptv-stream-proxy', version: 1 });
  });

  it('follows redirects and rewrites playlists against the final URL', async () => {
    const response = await viaProxy('/redirect');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-final-url')).toBe(`${origin}/live/index.m3u8`);
    const segment = (await response.text()).split('\n')[3];
    expect(segment).toBe(`?${new URLSearchParams({ url: `${origin}/live/seg.ts` })}`);
  });

  it('streams media untouched', async () => {
    const response = await viaProxy('/seg.ts');
    expect(response.headers.get('content-type')).toBe('video/mp2t');
    expect(response.headers.get('content-length')).toBe(String(188 * 4));
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(188 * 4);
    expect(bytes.every((b) => b === 0x47)).toBe(true);
  });

  it('leaves channel lists alone in raw mode', async () => {
    const response = await viaProxy('/list.m3u', '&raw=1');
    expect(await response.text()).toBe('#EXTM3U\n#EXTINF:-1,A\nhttp://x/a.m3u8\n');
  });

  it('drops the upstream length of compressed bodies', async () => {
    const response = await viaProxy('/gzip', '&raw=1');
    expect(response.headers.get('content-length')).toBeNull();
    expect(await response.text()).toContain('Zipped');
  });

  it('sends the requested user agent, referrer and range upstream', async () => {
    const response = await viaProxy('/echo', `&ua=${encodeURIComponent('VLC/3.0')}&ref=${encodeURIComponent('http://ref.example/')}`, {
      range: 'bytes=0-99',
    });
    expect(await response.json()).toEqual({ ua: 'VLC/3.0', ref: 'http://ref.example/', range: 'bytes=0-99' });
  });

  it('passes upstream error statuses through', async () => {
    const response = await viaProxy('/missing');
    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects unusable targets', async () => {
    const status = async (/** @type {string} */ query) =>
      (await handleProxyRequest(new Request(`http://proxy.test/proxy${query}`))).status;
    expect(await status('')).toBe(400);
    expect(await status('?url=not-a-url')).toBe(400);
    expect(await status(`?url=${encodeURIComponent('ftp://x/file')}`)).toBe(400);
    expect(await status(`?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data')}`)).toBe(403);
  });

  it('reports unreachable upstreams as 502', async () => {
    const response = await handleProxyRequest(
      new Request(`http://proxy.test/proxy?url=${encodeURIComponent('http://127.0.0.1:1/nothing')}`),
    );
    expect(response.status).toBe(502);
  });
});
