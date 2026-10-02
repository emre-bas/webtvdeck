// @ts-check
import { Readable } from 'node:stream';
import { handleProxyRequest } from './proxy-core.js';

/**
 * Adapts the web-standard proxy to Node's http server and Connect-style middleware (Vite).
 * When mounted under a prefix Connect strips it from req.url, which is fine: the proxy only
 * reads the query string and a trailing /health.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createNodeProxyHandler() {
  return (req, res) => {
    // Closing the player (or zapping away) must also close the upstream connection: many
    // IPTV providers only allow one stream per account at a time.
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    const headers = new Headers();
    for (const name of ['range', 'user-agent']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    const request = new Request(new URL(req.url ?? '/', 'http://localhost'), {
      method: req.method,
      headers,
      signal: abort.signal,
    });

    handleProxyRequest(request).then(
      (response) => send(res, response, req.method === 'HEAD'),
      (error) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        res.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ error: 'proxy_failure', detail: error instanceof Error ? error.message : String(error) }));
      },
    );
  };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {Response} response
 * @param {boolean} headOnly
 */
function send(res, response, headOnly) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  const body = response.body;
  if (!body || headOnly) {
    res.end();
    body?.cancel().catch(() => {});
    return;
  }
  const stream = Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream<Uint8Array>} */ (body));
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
