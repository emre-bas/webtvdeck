/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createNodeProxyHandler } from './server/node-proxy.js';

const { version, productName } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
  productName: string;
};

/** Mounts the stream proxy (server/proxy-core.js) at /proxy for `vite` and `vite preview`. */
function streamProxy(): Plugin {
  const handler = createNodeProxyHandler();
  return {
    name: 'stream-proxy',
    configureServer(server) {
      server.middlewares.use('/proxy', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/proxy', handler);
    },
  };
}

/** Fills in %APP_NAME% in index.html, the page-side twin of __APP_NAME__. */
function appName(): Plugin {
  return {
    name: 'app-name',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%APP_NAME%', productName),
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative asset URLs let one build run at a site root (npm start) and under a subpath (GitHub Pages).
  base: mode === 'production' ? './' : '/',
  define: {
    __APP_NAME__: JSON.stringify(productName),
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    // hls.js alone is ~575 kB; it's split out and only loaded when a stream starts.
    chunkSizeWarningLimit: 700,
    // MIT/Apache/ISC notices of the bundled libraries must ship with the app (minification strips them).
    license: { fileName: 'third-party-licenses.txt' },
  },
  plugins: [
    react(),
    appName(),
    streamProxy(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png', 'demo.m3u'],
      manifest: {
        name: productName,
        short_name: productName,
        description: 'Full-screen IPTV player for your own M3U playlists.',
        start_url: './',
        scope: './',
        lang: 'tr',
        theme_color: '#07080a',
        background_color: '#07080a',
        display: 'standalone',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        categories: ['entertainment', 'video'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,m3u}'],
        navigateFallback: 'index.html',
        // Streams and playlists must always hit the network (and the proxy), never the SW cache.
        navigateFallbackDenylist: [/^\/proxy/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.js'],
  },
}));
