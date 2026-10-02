import { describe, expect, it } from 'vitest';
import { httpsTwin } from './proxy';

describe('httpsTwin', () => {
  it('switches plain HTTP to HTTPS', () => {
    expect(httpsTwin('http://cdn.example.com/live/ntv.m3u8?token=1')).toBe('https://cdn.example.com/live/ntv.m3u8?token=1');
    expect(httpsTwin('HTTP://cdn.example.com:80/live.m3u8')).toBe('https://cdn.example.com/live.m3u8');
  });

  it('skips custom ports and IP addresses, which practically never serve TLS', () => {
    expect(httpsTwin('http://cdn.example.com:8080/user/pass/1.ts')).toBeNull();
    expect(httpsTwin('http://203.0.113.7/live.m3u8')).toBeNull();
    expect(httpsTwin('http://[2001:db8::1]/live.m3u8')).toBeNull();
  });

  it('leaves anything that is not plain HTTP alone', () => {
    expect(httpsTwin('https://cdn.example.com/live.m3u8')).toBeNull();
    expect(httpsTwin('not a url')).toBeNull();
  });
});
