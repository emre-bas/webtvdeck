import type { ErrorData } from 'hls.js';
import type { Engine, EngineCallbacks, EngineKind, PlaybackError } from './types';

/** The engine can't run in this browser at all (no MediaSource); try the next one. */
export class EngineUnavailableError extends Error {
  constructor(engine: EngineKind) {
    super(`${engine} is not supported in this browser`);
    this.name = 'EngineUnavailableError';
  }
}

/** hls.js and mpegts.js are loaded on demand; the first screen doesn't need them. */
export function createEngine(kind: EngineKind, video: HTMLVideoElement, url: string, callbacks: EngineCallbacks): Promise<Engine> {
  switch (kind) {
    case 'hls':
      return createHlsEngine(video, url, callbacks);
    case 'mpegts':
      return createMpegtsEngine(video, url, callbacks);
    case 'native':
      return Promise.resolve(createNativeEngine(video, url, callbacks));
  }
}

async function createHlsEngine(video: HTMLVideoElement, url: string, callbacks: EngineCallbacks): Promise<Engine> {
  const { default: Hls } = await import('hls.js');
  if (!Hls.isSupported()) throw new EngineUnavailableError('hls');

  const hls = new Hls({ enableWorker: true, liveDurationInfinity: true, backBufferLength: 30 });
  let mediaRecoveries = 0;

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;
    // Decoder hiccups are common on live TV; the documented recovery usually fixes them.
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
      mediaRecoveries++;
      if (mediaRecoveries === 2) hls.swapAudioCodec();
      hls.recoverMediaError();
      return;
    }
    callbacks.onFatal(mapHlsError(Hls, data));
  });
  const onTracks = () => callbacks.onTracks();
  hls.on(Hls.Events.MANIFEST_PARSED, onTracks);
  hls.on(Hls.Events.LEVEL_SWITCHED, onTracks);
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, onTracks);
  hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, onTracks);

  hls.loadSource(url);
  hls.attachMedia(video);

  return {
    kind: 'hls',
    destroy: () => hls.destroy(),
    levels: () => hls.levels.map((level, index) => ({ index, height: level.height || undefined, bitrate: level.bitrate || undefined })),
    level: () => (hls.autoLevelEnabled ? -1 : hls.currentLevel),
    setLevel: (index) => {
      hls.currentLevel = index;
    },
    audioTracks: () => hls.audioTracks.map((track, index) => ({ index, name: track.name, lang: track.lang })),
    audioTrack: () => hls.audioTrack,
    setAudioTrack: (index) => {
      hls.audioTrack = index;
    },
  };
}

function mapHlsError(Hls: typeof import('hls.js').default, data: ErrorData): PlaybackError {
  const { ErrorDetails, ErrorTypes } = Hls;
  const detail = data.details;
  switch (data.details) {
    case ErrorDetails.MANIFEST_PARSING_ERROR:
      return { kind: 'format', detail };
    case ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR:
    case ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR:
      return { kind: 'unsupported', detail };
    case ErrorDetails.MANIFEST_LOAD_TIMEOUT:
    case ErrorDetails.LEVEL_LOAD_TIMEOUT:
    case ErrorDetails.FRAG_LOAD_TIMEOUT:
      return { kind: 'timeout', detail };
  }
  if (data.type === ErrorTypes.KEY_SYSTEM_ERROR) return { kind: 'drm', detail };
  if (data.type === ErrorTypes.NETWORK_ERROR) {
    const status = data.response?.code;
    return status && status >= 400 ? { kind: 'http', status, detail } : { kind: 'network', detail };
  }
  return { kind: 'media', detail };
}

async function createMpegtsEngine(video: HTMLVideoElement, url: string, callbacks: EngineCallbacks): Promise<Engine> {
  const { default: mpegts } = await import('mpegts.js');
  if (!mpegts.isSupported()) throw new EngineUnavailableError('mpegts');

  // "mse" lets mpegts.js probe the container itself (MPEG-TS or FLV).
  const player = mpegts.createPlayer(
    { type: 'mse', isLive: true, url },
    {
      enableWorker: true,
      lazyLoad: false,
      // Live TV runs for hours; without cleanup the SourceBuffer eventually overflows.
      autoCleanupSourceBuffer: true,
      referrerPolicy: 'no-referrer',
    },
  );
  const { ErrorDetails, ErrorTypes, Events } = mpegts;

  player.on(Events.ERROR, (type: string, detail: string, info?: { code?: number }) => {
    let error: PlaybackError;
    if (type === ErrorTypes.NETWORK_ERROR) {
      if (detail === ErrorDetails.NETWORK_STATUS_CODE_INVALID && info?.code) error = { kind: 'http', status: info.code, detail };
      else if (detail === ErrorDetails.NETWORK_TIMEOUT) error = { kind: 'timeout', detail };
      else error = { kind: 'network', detail };
    } else if (detail === ErrorDetails.MEDIA_FORMAT_UNSUPPORTED || detail === ErrorDetails.MEDIA_FORMAT_ERROR) {
      error = { kind: 'format', detail };
    } else if (detail === ErrorDetails.MEDIA_CODEC_UNSUPPORTED) {
      error = { kind: 'unsupported', detail };
    } else {
      error = { kind: 'media', detail };
    }
    callbacks.onFatal(error);
  });
  player.on(Events.LOADING_COMPLETE, () => callbacks.onSourceEnded());

  player.attachMediaElement(video);
  player.load();

  return {
    kind: 'mpegts',
    destroy: () => {
      try {
        player.pause();
        player.destroy();
      } catch {
        // Already torn down.
      }
    },
  };
}

function createNativeEngine(video: HTMLVideoElement, url: string, callbacks: EngineCallbacks): Engine {
  const onError = () => {
    const error = video.error;
    const detail = error?.message || undefined;
    switch (error?.code) {
      case MediaError.MEDIA_ERR_NETWORK:
        callbacks.onFatal({ kind: 'network', detail });
        break;
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        callbacks.onFatal({ kind: 'format', detail });
        break;
      default:
        callbacks.onFatal({ kind: 'media', detail });
    }
  };
  video.addEventListener('error', onError);
  video.src = url;

  return {
    kind: 'native',
    destroy: () => {
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
    },
  };
}
