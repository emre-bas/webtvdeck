<div align="center">

<img src="./public/pwa-192x192.png" alt="WebTVDeck" width="96" height="96" />

# WebTVDeck

**A full-screen IPTV player for the browser. Bring your own M3U playlist.**

Add your playlist and watch. Channels, favorites, history, playlists and settings live in a menu that slides in from the right. Installable as a PWA.

[**Live demo**](https://emre-bas.github.io/webtvdeck/) · [Features](#features) · [Getting started](#getting-started) · [Self-hosting](#self-hosting) · [Legal](#legal)

[![License: MIT](https://img.shields.io/badge/License-MIT-2fb4e6.svg)](./LICENSE)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6.svg)](https://www.typescriptlang.org)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8.svg)](#features)

</div>

---

> The live demo plays the [demo playlist](#demo-content). Most IPTV providers block browsers, so your own playlist usually needs the built-in proxy: [run WebTVDeck on your own machine](#self-hosting).

## Features

- **Your own playlist**: add an M3U/M3U8 link or upload a file (drag and drop works too). Lists with tens of thousands of entries are parsed in a Web Worker and stored in IndexedDB, on the device only.
- **Plays what IPTV providers actually serve**: HLS (hls.js), MPEG-TS and FLV (mpegts.js), and MP4/WebM/audio through the browser. Extension-less Xtream-style URLs are detected automatically.
- **Full-screen player** with auto-hiding controls, live badge, quality and audio-track selection, picture-in-picture, a seek bar for on-demand content and an audio-only view for radio.
- **Right-side menu**: channels with groups and diacritic-insensitive search (`izmir` finds `İZMİR`), favorites, watch history, playlist management and settings. Virtualized lists stay smooth with 50k+ channels.
- **Programme guide (EPG)**: XMLTV guides (`url-tvg` from the playlist or a custom URL, `.xml` or `.xml.gz`) are streamed and parsed in a worker. Shows what's on in the channel list, now/next in the player and a programme info panel.
- **Resilient playback**: falls back between engines, retries through the proxy when a server blocks the browser, reconnects dropped live streams with backoff and explains failures (403, 404, CORS, unsupported codec…).
- **TV-style controls**: arrow keys and channel up/down zap, number keys jump to a channel, Enter opens the list; swipe gestures on touch screens; media keys via the Media Session API.
- **PWA**: installable, works offline for the app shell, prompts before updating so playback isn't interrupted.
- Turkish and English UI.

## Getting started

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173, then paste a playlist link, upload a file, or pick **Try the demo** (openly licensed films and a test signal, see [Demo content](#demo-content)).

## Demo content

**Try the demo** loads [public/demo.m3u](public/demo.m3u).

| Channel | Content | Credit and license | Streamed from |
| --- | --- | --- | --- |
| Big Buck Bunny | Blender open movie | (c) copyright 2008, Blender Foundation / [www.bigbuckbunny.org](https://www.bigbuckbunny.org), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Mux, test-videos.co.uk |
| Tears of Steel | Blender open movie | (CC) Blender Foundation \| [mango.blender.org](https://mango.blender.org), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Unified Streaming |
| Canlı Test Yayını (live test) | Colour bars and a clock | Unified Streaming's test signal | Unified Streaming |

## Why there is a proxy

Browsers are much stricter than VLC or a set-top box:

- most IPTV servers don't send CORS headers, so page scripts (hls.js, mpegts.js) can't read the streams;
- many serve plain HTTP, which HTTPS pages aren't allowed to load (mixed content);
- some require a specific `User-Agent` or `Referer` (`#EXTVLCOPT:http-user-agent=…`, `|User-Agent=…`), and browsers don't let pages set those.

WebTVDeck therefore comes with a small stream proxy ([server/proxy-core.js](server/proxy-core.js)). It relays requests, applies the headers a channel needs and rewrites HLS playlists so that every variant, segment and key goes through it too. The app tries direct access first and switches to the proxy only when needed (or always, see Settings → Proxy); it remembers which servers need it.

The proxy is built in when you run the app with `npm run dev`, `npm run preview` or `npm start`.

## Self-hosting

```bash
npm run build
npm start                  # http://localhost:8080
npm start -- --host        # also reachable from your TV or phone on the local network
npm start -- --port 3000   # or use the PORT / HOST environment variables
```

[server/serve.js](server/serve.js) serves the built app and the proxy from one dependency-free Node process, which suits a home server, NAS or Raspberry Pi.

> **Security:** the proxy fetches arbitrary URLs for whoever can reach it. Keep it on your own network or behind authentication; don't expose it to the internet as-is. Cloud metadata addresses are blocked, private LAN addresses are allowed on purpose (local IPTV servers).

### Static hosting

The `dist/` folder is a static site with relative URLs, so it can be deployed anywhere, at a domain root or under a subpath (GitHub Pages, Netlify, Vercel…). Publishing a GitHub release deploys it to GitHub Pages ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)).

Without the built-in proxy only streams that allow browser access will play. You can point the app to a proxy running elsewhere under **Settings → Proxy → Custom proxy address** (for example `https://tv.example.com/proxy`). `proxy-core.js` only uses web-standard `Request`/`Response`, so it also runs on Deno, Bun or edge workers. An app served over HTTPS needs an HTTPS proxy.

The build writes the license notices of the bundled libraries to `dist/third-party-licenses.txt`; keep that file when you deploy `dist/`.

## Keyboard and remote

| Key | Action |
| --- | --- |
| ↑ ↓, Page Up/Down, Channel +/- | Previous / next channel |
| Enter, → | Open the channel list (Enter on the playing channel goes back to full screen) |
| 0–9 | Go to a channel number |
| Space, K | Play / pause |
| M | Mute |
| F | Full screen |
| P | Picture in picture |
| L, Backspace | Back to the previous channel |
| I | Programme info |
| Esc | Close menu / panel |
| Back (remote, Android, browser) | Close menu / panel; with nothing open, press twice to exit |

## Supported playlists

Extended M3U as used by IPTV providers: `#EXTINF` attributes (`tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-chno`, `tvg-shift`, `radio`), `#EXTGRP`, `#EXTVLCOPT` headers, Kodi-style `url|User-Agent=…` suffixes, `url-tvg`/`x-tvg-url` guides, relative URLs, UTF-8/UTF-16 and legacy encodings.

Not supported, because browsers can't do it: `rtmp://`, `rtsp://`, `udp://` streams (they are skipped on import), DRM-protected streams, and codecs the browser lacks (HEVC/H.265 and AC-3 depend on the browser and platform).

## Development

```bash
npm run dev        # dev server with the proxy
npm test           # unit tests (Vitest): M3U parser, XMLTV parser, engine selection, proxy
npm run typecheck  # TypeScript, including the JSDoc-typed server
npm run lint       # oxlint
npm run build      # production build + service worker
```

CI runs lint, tests and the build on every push and pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

```
server/            proxy (web-standard core + Node adapter) and production server
src/lib/           M3U and XMLTV parsers, networking, storage, text helpers
src/player/        playback controller and engines (hls.js, mpegts.js, native)
src/store/         app state (zustand): library (persisted), session, guide, toasts
src/components/    onboarding, player UI, right-side drawer panels
src/workers/       playlist and guide parsing off the main thread
```

Built with React 19, TypeScript, Vite 8, vite-plugin-pwa, hls.js, mpegts.js, zustand, idb and TanStack Virtual.

## Legal

WebTVDeck is a player, like VLC or a web browser. It plays the playlists you add; it doesn't provide, host, sell or recommend any channels or streams. You are responsible for having the right to watch what you add.

**Never post your playlist URL or provider credentials** in issues or discussions: IPTV links usually contain your username and password.

## License

[MIT License](./LICENSE)
