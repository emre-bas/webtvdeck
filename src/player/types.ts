export type EngineKind = 'hls' | 'mpegts' | 'native';

export type PlaybackErrorKind =
  | 'network' // unreachable, CORS, connection dropped
  | 'http' // the server answered with an error status
  | 'mixed-content' // plain HTTP stream on an HTTPS page without a proxy
  | 'format' // not a format this engine understands
  | 'unsupported' // the browser can't decode it (codec, missing MSE)
  | 'media' // decoding failed midway
  | 'timeout'
  | 'drm';

export interface PlaybackError {
  kind: PlaybackErrorKind;
  status?: number;
  /** Engine-specific detail for the technical info line. */
  detail?: string;
  engine?: EngineKind;
  /** The failing request already went through the proxy. */
  viaProxy?: boolean;
}

export interface QualityLevel {
  index: number;
  height?: number;
  bitrate?: number;
}

export interface AudioTrack {
  index: number;
  name?: string;
  lang?: string;
}

export interface Engine {
  readonly kind: EngineKind;
  destroy(): void;
  levels?(): QualityLevel[];
  /** Selected level; -1 means automatic. */
  level?(): number;
  setLevel?(index: number): void;
  audioTracks?(): AudioTrack[];
  audioTrack?(): number;
  setAudioTrack?(index: number): void;
}

export interface EngineCallbacks {
  /** Unrecoverable error; the controller decides whether to fall back, reconnect or give up. */
  onFatal(error: PlaybackError): void;
  /** The server closed a live stream; playback stops once the buffer runs dry. */
  onSourceEnded(): void;
  /** Quality levels or audio tracks changed. */
  onTracks(): void;
}
