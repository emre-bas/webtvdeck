#!/usr/bin/env node
// @ts-check
/**
 * Production server: serves the built app from dist/ and the stream proxy under /proxy.
 *
 *   npm run build && npm start               → http://localhost:8080
 *   npm start -- --host                      → also reachable from other devices (TV, phone)
 *   npm start -- --port 3000                 (or PORT / HOST environment variables)
 *
 * The proxy relays arbitrary URLs. Keep this server on your own network or put it behind
 * authentication; don't expose it to the internet as-is.
 */
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createNodeProxyHandler } from './node-proxy.js';

const { values: args } = parseArgs({
  options: {
    host: { type: 'boolean', default: false },
    port: { type: 'string', short: 'p' },
  },
});

const port = Number(args.port ?? process.env.PORT ?? 8080);
const host = process.env.HOST ?? (args.host ? '0.0.0.0' : 'localhost');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const { productName } = /** @type {{ productName: string }} */ (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
);

/** @type {Record<string, string>} */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.m3u': 'audio/x-mpegurl; charset=utf-8',
  '.map': 'application/json',
};

const proxy = createNodeProxyHandler();

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (pathname === '/proxy' || pathname.startsWith('/proxy/')) {
    proxy(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  serveStatic(req, res, pathname).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} pathname
 */
async function serveStatic(req, res, pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  let file = path.join(root, relative);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }

  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = path.join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info && !path.extname(relative)) {
    // Client-side routes fall back to the app shell.
    file = path.join(root, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    // Hashed build assets never change; everything else (index.html, sw.js, manifest) must revalidate.
    'cache-control': relative.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

server.listen(port, host, () => {
  const urls = [`http://localhost:${port}`];
  if (host === '0.0.0.0' || host === '::') {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) urls.push(`http://${address.address}:${port}`);
      }
    }
  } else if (host !== 'localhost') {
    urls[0] = `http://${host}:${port}`;
  }
  console.log(`${productName} is running:\n${urls.map((url) => `  ➜ ${url}`).join('\n')}`);
  if (urls.length === 1) console.log('  (use --host to open it from other devices on your network)');
});
