import { describe, expect, it } from 'vitest';
import { engineChain, extensionOf } from './stream-type';

const none = () => false;
const all = () => true;

describe('extensionOf', () => {
  it('ignores queries and dots in directory names', () => {
    expect(extensionOf('http://h/live/a.b/index.M3U8?token=1.2')).toBe('m3u8');
    expect(extensionOf('http://h/v1.2/stream')).toBe('');
  });
});

describe('engineChain', () => {
  it('uses hls.js for playlists, with native HLS as a fallback where supported', () => {
    expect(engineChain('http://h/live/1.m3u8', none)).toEqual(['hls']);
    expect(engineChain('http://h/live/1.m3u8', all)).toEqual(['hls', 'native']);
    expect(engineChain('http://h/play?format=m3u8', none)).toEqual(['hls']);
  });

  it('uses mpegts.js for transport streams', () => {
    expect(engineChain('http://h/live/u/p/1.ts', none)).toEqual(['mpegts']);
    expect(engineChain('http://h/get?output=ts&id=1', none)).toEqual(['mpegts']);
  });

  it('plays files natively', () => {
    expect(engineChain('http://h/movie/u/p/42.mp4', none)).toEqual(['native']);
    expect(engineChain('http://h/radio.aac', none)).toEqual(['native']);
  });

  it('tries everything for extension-less URLs', () => {
    expect(engineChain('http://h:8080/user/pass/12345', none)).toEqual(['mpegts', 'native', 'hls']);
  });
});
