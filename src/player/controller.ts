import { httpsTwin, isMixedContent, knownToNeedProxy, proxied, rememberNeedsProxy, type ProxyConfig } from '../lib/proxy';
import { createEngine } from './engines';
import { engineChain } from './stream-type';
import type { AudioTrack, Engine, EngineCallbacks, EngineKind, PlaybackError, QualityLevel } from './types';

export type PlayerPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'reconnecting' | 'error';

export interface PlaybackSource {
  url: string;
  userAgent?: string;
  referrer?: string;
}

export interface PlayerState {
  phase: PlayerPhase;
  error: PlaybackError | null;
  engine: EngineKind | null;
  viaProxy: boolean;
  /** A proxy is configured, so "try through the proxy" is worth offering. */
  proxyAvailable: boolean;
  /** Unmuted autoplay was blocked by the browser; playing muted until the user unmutes. */
  autoplayMuted: boolean;
  audioOnly: boolean;
  live: boolean;
  muted: boolean;
  volume: number;
  videoSize: { width: number; height: number } | null;
  levels: QualityLevel[];
  /** Selected quality level; -1 is automatic. */
  level: number;
  audioTracks: AudioTrack[];
  audioTrack: number;
  reconnectAttempt: number;
}

interface Route {
  kind: EngineKind;
  viaProxy: boolean;
  /** Where the stream loads from without the proxy: its own URL, or the https:// twin of a plain-HTTP one. */
  directUrl: string;
}

type AttemptResult = { ok: true } | { ok: false; error: PlaybackError };

const START_TIMEOUT_MS = 20_000;
const STALL_TIMEOUT_MS = 12_000;
export const MAX_RECONNECTS = 4;
/** Playback that lasted this long before failing gets a fresh set of reconnect attempts. */
const STABLE_PLAYBACK_MS = 30_000;

/** When every engine fails, the most telling error wins: a 403 says more than "not HLS". */
const ERROR_PRIORITY: PlaybackError['kind'][] = ['format', 'media', 'timeout', 'unsupported', 'network', 'http', 'drm', 'mixed-content'];

const STREAM_STATE = {
  error: null,
  engine: null,
  viaProxy: false,
  audioOnly: false,
  live: true,
  videoSize: null,
  levels: [],
  level: -1,
  audioTracks: [],
  audioTrack: -1,
  reconnectAttempt: 0,
} satisfies Partial<PlayerState>;

/**
 * Drives one <video> element: picks an engine for each stream, falls back to other engines
 * and to the proxy when a stream won't open, reconnects dropped live streams and exposes a
 * snapshot for React (useSyncExternalStore).
 */
export class PlayerController {
  readonly video: HTMLVideoElement;
  private readonly getProxy: () => ProxyConfig;
  private readonly listeners = new Set<() => void>();
  private readonly unbindVideo: () => void;
  private state: PlayerState;
  private engine: Engine | null = null;
  /** Bumped by play()/stop(); async work from an older session is discarded. */
  private session = 0;
  /** Bumped whenever the engine changes; events from a torn-down engine are ignored. */
  private engineToken = 0;
  private source: PlaybackSource | null = null;
  private route: Route | null = null;
  private settleAttempt: ((result: AttemptResult) => void) | null = null;
  private sourceEnded = false;
  private playingSince = 0;
  private reconnectTimer = 0;
  private stallTimer = 0;

  constructor(video: HTMLVideoElement, getProxy: () => ProxyConfig) {
    this.video = video;
    this.getProxy = getProxy;
    this.state = {
      ...STREAM_STATE,
      phase: 'idle',
      proxyAvailable: false,
      autoplayMuted: false,
      muted: video.muted,
      volume: video.volume,
    };
    this.unbindVideo = this.bindVideo();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PlayerState => this.state;

  async play(source: PlaybackSource, options: { forceProxy?: boolean } = {}): Promise<void> {
    const session = this.reset();
    this.source = source;
    const proxy = this.getProxy();
    this.update({ ...STREAM_STATE, phase: 'loading', proxyAvailable: proxy.endpoint !== null });

    const result = await this.start(source, proxy, session, options.forceProxy ?? false);
    if (session !== this.session) return;
    if ('error' in result) this.fail(result.error);
    else this.route = result;
  }

  retry(options: { forceProxy?: boolean } = {}): void {
    if (this.source) void this.play(this.source, options);
  }

  stop(): void {
    this.reset();
    this.source = null;
    this.update({ ...STREAM_STATE, phase: 'idle' });
  }

  togglePlay(): void {
    if (this.state.phase === 'error') this.retry();
    else if (this.video.paused) this.video.play().catch(() => {});
    else this.video.pause();
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
    if (!muted) this.update({ autoplayMuted: false });
  }

  setVolume(volume: number): void {
    this.video.volume = Math.min(1, Math.max(0, volume));
    if (volume > 0) this.setMuted(false);
  }

  seek(seconds: number): void {
    this.video.currentTime = seconds;
  }

  setLevel(index: number): void {
    this.engine?.setLevel?.(index);
    this.syncTracks();
  }

  setAudioTrack(index: number): void {
    this.engine?.setAudioTrack?.(index);
    this.syncTracks();
  }

  destroy(): void {
    this.reset();
    this.unbindVideo();
    this.listeners.clear();
  }

  /** Cancels everything in flight and starts a new session. */
  private reset(): number {
    this.session++;
    this.settleAttempt?.({ ok: false, error: { kind: 'media', detail: 'superseded' } });
    this.clearTimers();
    this.destroyEngine();
    this.route = null;
    return this.session;
  }

  private async start(source: PlaybackSource, proxy: ProxyConfig, session: number, forceProxy: boolean): Promise<Route | { error: PlaybackError }> {
    const { endpoint } = proxy;
    const mixed = isMixedContent(source.url);
    // Browsers can't set User-Agent/Referer themselves, only the proxy can.
    const needsHeaders = Boolean(source.userAgent || source.referrer || proxy.userAgent);
    let viaProxy =
      endpoint !== null && (forceProxy || proxy.mode === 'always' || mixed || needsHeaders || knownToNeedProxy(source.url));
    // Without a proxy, a plain-HTTP stream can still play if its server also speaks HTTPS.
    const directUrl = mixed && !viaProxy ? httpsTwin(source.url) : source.url;
    if (directUrl === null) return { error: { kind: 'mixed-content' } };

    const chain = engineChain(source.url, (mime) => this.video.canPlayType(mime) !== '');
    const errors: PlaybackError[] = [];

    for (let i = 0; i < chain.length; ) {
      const kind = chain[i]!;
      const url = viaProxy && endpoint !== null ? this.proxiedUrl(endpoint, source, proxy) : directUrl;
      const result = await this.attempt(kind, url, session);
      if (session !== this.session) return { error: { kind: 'media', detail: 'superseded' } };

      if (result.ok) {
        // Decided once per stream: when a live TS stream drops, mpegts.js ends the MediaSource
        // and the duration turns finite, but the channel is still live and must reconnect.
        this.update({
          engine: kind,
          viaProxy,
          live: !Number.isFinite(this.video.duration),
          ...(this.video.paused ? { phase: 'paused' as const } : {}),
        });
        return { kind, viaProxy, directUrl };
      }

      const error = normalizeError(result.error, kind, viaProxy);
      errors.push(error);
      this.destroyEngine();
      // CORS failures and 401/403s aimed at browsers often go away through the proxy.
      if (!viaProxy && endpoint !== null && (error.kind === 'network' || error.status === 401 || error.status === 403)) {
        rememberNeedsProxy(source.url);
        viaProxy = true;
        continue;
      }
      i++;
    }

    // The https:// twin failed too; the stream's own address is still the one that can't play.
    if (mixed && !viaProxy) return { error: { kind: 'mixed-content' } };
    return { error: errors.reduce((best, error) => (rank(error) > rank(best) ? error : best)) };
  }

  /** Loads the stream with one engine; resolves once the first frame is decoded, or on failure. */
  private attempt(kind: EngineKind, url: string, session: number): Promise<AttemptResult> {
    return new Promise((resolve) => {
      const video = this.video;
      const token = ++this.engineToken;
      let timer = 0;

      const onReady = () => settle({ ok: true });
      const settle = (result: AttemptResult) => {
        if (this.settleAttempt !== settle) return;
        this.settleAttempt = null;
        window.clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        resolve(result);
      };

      this.settleAttempt = settle;
      this.sourceEnded = false;
      video.addEventListener('loadeddata', onReady);
      timer = window.setTimeout(() => settle({ ok: false, error: { kind: 'timeout' } }), START_TIMEOUT_MS);

      createEngine(kind, video, url, this.callbacks(token)).then(
        (engine) => {
          if (token !== this.engineToken || this.settleAttempt !== settle) {
            engine.destroy();
            return;
          }
          this.engine = engine;
          void this.autoplay(session);
        },
        (error: unknown) => settle({ ok: false, error: { kind: 'unsupported', detail: error instanceof Error ? error.message : String(error) } }),
      );
    });
  }

  private callbacks(token: number): EngineCallbacks {
    const current = () => token === this.engineToken;
    return {
      onFatal: (error) => {
        if (!current()) return;
        if (this.settleAttempt) this.settleAttempt({ ok: false, error });
        else this.recover(error);
      },
      onSourceEnded: () => {
        if (!current()) return;
        this.sourceEnded = true;
        if (this.state.phase === 'buffering') this.recover({ kind: 'network', detail: 'stream ended' });
      },
      onTracks: () => {
        if (current()) this.syncTracks();
      },
    };
  }

  /** A stream that was playing failed: reconnect with the same engine and route, backing off. */
  private recover(error: PlaybackError): void {
    const session = this.session;
    const { source, route } = this;
    const stable = this.playingSince > 0 && Date.now() - this.playingSince > STABLE_PLAYBACK_MS;
    this.clearTimers();
    this.destroyEngine();
    if (!source || !route) {
      this.fail(error);
      return;
    }

    const attempt = stable ? 1 : this.state.reconnectAttempt + 1;
    if (attempt > MAX_RECONNECTS) {
      this.fail(error);
      return;
    }
    this.update({ phase: 'reconnecting', reconnectAttempt: attempt });

    this.reconnectTimer = window.setTimeout(async () => {
      const proxy = this.getProxy();
      const url = route.viaProxy && proxy.endpoint !== null ? this.proxiedUrl(proxy.endpoint, source, proxy) : route.directUrl;
      const result = await this.attempt(route.kind, url, session);
      if (session === this.session && !result.ok) this.recover(normalizeError(result.error, route.kind, route.viaProxy));
    }, Math.min(1000 * 2 ** (attempt - 1), 8000));
  }

  private fail(error: PlaybackError): void {
    this.clearTimers();
    this.destroyEngine();
    this.route = null;
    this.update({ phase: 'error', error });
  }

  private async autoplay(session: number): Promise<void> {
    const video = this.video;
    try {
      await video.play();
    } catch (error) {
      // AbortError just means a newer load interrupted this one.
      if (session !== this.session || !(error instanceof DOMException) || error.name !== 'NotAllowedError') return;
      // Without a prior user gesture browsers only allow muted autoplay.
      video.muted = true;
      try {
        await video.play();
        if (session === this.session) this.update({ autoplayMuted: true });
      } catch {
        if (session === this.session) this.update({ phase: 'paused' });
      }
    }
  }

  private proxiedUrl(endpoint: string, source: PlaybackSource, proxy: ProxyConfig): string {
    return proxied(endpoint, source.url, { userAgent: source.userAgent || proxy.userAgent, referrer: source.referrer });
  }

  private bindVideo(): () => void {
    const video = this.video;
    const handlers: Record<string, () => void> = {
      playing: () => {
        this.clearStall();
        this.playingSince ||= Date.now();
        this.update({ phase: 'playing', ...this.mediaInfo() });
      },
      pause: () => {
        if (this.state.phase !== 'playing' && this.state.phase !== 'buffering') return;
        this.clearStall();
        this.update({ phase: 'paused' });
      },
      waiting: () => {
        if (this.state.phase !== 'playing') return;
        if (this.sourceEnded) {
          this.recover({ kind: 'network', detail: 'stream ended' });
          return;
        }
        this.update({ phase: 'buffering' });
        this.clearStall();
        this.stallTimer = window.setTimeout(() => this.recover({ kind: 'timeout', detail: 'stalled' }), STALL_TIMEOUT_MS);
      },
      ended: () => {
        if (!this.route) return; // not started yet, or already given up
        if (this.state.live) this.recover({ kind: 'network', detail: 'stream ended' });
        else this.update({ phase: 'paused' });
      },
      volumechange: () => this.update({ muted: video.muted, volume: video.volume }),
      loadedmetadata: () => this.update(this.mediaInfo()),
      resize: () => this.update(this.mediaInfo()),
    };
    for (const [type, handler] of Object.entries(handlers)) video.addEventListener(type, handler);
    return () => {
      for (const [type, handler] of Object.entries(handlers)) video.removeEventListener(type, handler);
    };
  }

  private mediaInfo(): Pick<PlayerState, 'videoSize' | 'audioOnly'> {
    const { videoWidth: width, videoHeight: height, readyState } = this.video;
    return {
      videoSize: width && height ? { width, height } : null,
      audioOnly: readyState >= HTMLMediaElement.HAVE_METADATA && !width,
    };
  }

  private syncTracks(): void {
    const engine = this.engine;
    if (!engine) return;
    this.update({
      levels: engine.levels?.() ?? [],
      level: engine.level?.() ?? -1,
      audioTracks: engine.audioTracks?.() ?? [],
      audioTrack: engine.audioTrack?.() ?? -1,
    });
  }

  private destroyEngine(): void {
    this.engineToken++;
    this.sourceEnded = false;
    this.playingSince = 0;
    const engine = this.engine;
    this.engine = null;
    engine?.destroy();
  }

  private clearStall(): void {
    window.clearTimeout(this.stallTimer);
    this.stallTimer = 0;
  }

  private clearTimers(): void {
    this.clearStall();
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
  }

  private update(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function normalizeError(error: PlaybackError, engine: EngineKind, viaProxy: boolean): PlaybackError {
  // The proxy answers 502 when it can't reach the stream server at all.
  if (viaProxy && error.kind === 'http' && error.status === 502) return { kind: 'network', detail: error.detail, engine, viaProxy };
  return { ...error, engine, viaProxy };
}

function rank(error: PlaybackError): number {
  return ERROR_PRIORITY.indexOf(error.kind);
}
