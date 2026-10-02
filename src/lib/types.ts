export interface Channel {
  /** Stream URL. Also the stable key for favorites, history and the last watched channel. */
  url: string;
  name: string;
  /** Display number: tvg-chno when the playlist provides one, otherwise the position. */
  num: number;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  /** Hours to shift EPG times by (tvg-shift). */
  tvgShift?: number;
  radio?: boolean;
  userAgent?: string;
  referrer?: string;
}

export interface PlaylistMeta {
  id: string;
  name: string;
  /** Remote source. Playlists added from a file have none and can't be refreshed. */
  url?: string;
  fileName?: string;
  /** XMLTV guide announced by the playlist header (url-tvg / x-tvg-url). */
  epgUrl?: string;
  /** Guide URL set by the user; takes precedence and survives playlist refreshes. */
  epgOverride?: string;
  /** User-Agent for this playlist's requests through the proxy; overrides the global setting. */
  userAgent?: string;
  channelCount: number;
  groupCount: number;
  addedAt: number;
  updatedAt: number;
}
