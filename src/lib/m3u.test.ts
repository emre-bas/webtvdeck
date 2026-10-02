import { describe, expect, it } from 'vitest';
import { M3UError, parseM3U } from './m3u';

describe('parseM3U', () => {
  it('reads channels with their attributes', () => {
    const { channels, epgUrls } = parseM3U(
      [
        '#EXTM3U url-tvg="http://epg.example/guide.xml.gz"',
        '#EXTINF:-1 tvg-id="trt1.tr" tvg-name="TRT 1" tvg-logo="http://logo.example/trt1.png" group-title="Ulusal",TRT 1 HD',
        'http://tv.example/live/trt1.m3u8',
        '#EXTINF:-1 tvg-id="atv.tr" tvg-chno="7" group-title="Ulusal",ATV',
        'http://tv.example/live/atv.ts',
      ].join('\n'),
    );

    expect(epgUrls).toEqual(['http://epg.example/guide.xml.gz']);
    expect(channels).toEqual([
      {
        url: 'http://tv.example/live/trt1.m3u8',
        name: 'TRT 1 HD',
        num: 1,
        logo: 'http://logo.example/trt1.png',
        group: 'Ulusal',
        tvgId: 'trt1.tr',
        tvgName: 'TRT 1',
      },
      { url: 'http://tv.example/live/atv.ts', name: 'ATV', num: 7, group: 'Ulusal', tvgId: 'atv.tr' },
    ]);
  });

  it('keeps commas inside quoted attributes and in titles', () => {
    const { channels } = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-logo="http://x/a,b.png" group-title="News, World",News, Weather & Sports\nhttp://x/1.m3u8',
    );
    expect(channels[0]).toMatchObject({
      name: 'News, Weather & Sports',
      group: 'News, World',
      logo: 'http://x/a,b.png',
    });
  });

  it('handles unquoted values, single quotes and a missing duration', () => {
    const { channels } = parseM3U(
      "#EXTM3U\n#EXTINF:0 tvg-id=abc group-title='Kids',Cartoon\nhttp://x/1\n#EXTINF:,Bare\nhttp://x/2",
    );
    expect(channels[0]).toMatchObject({ name: 'Cartoon', tvgId: 'abc', group: 'Kids' });
    expect(channels[1]).toMatchObject({ name: 'Bare', num: 2 });
  });

  it('recovers from an unterminated quote', () => {
    const { channels } = parseM3U('#EXTM3U\n#EXTINF:-1 group-title="Spor,Spor Kanalı\nhttp://x/1');
    expect(channels[0]).toMatchObject({ name: 'Spor Kanalı', group: 'Spor' });
  });

  it('supports CRLF line endings, a BOM and a missing #EXTM3U header', () => {
    const { channels } = parseM3U('﻿#EXTINF:-1,One\r\nhttp://x/1\r\n\r\n#EXTINF:-1,Two\r\nhttp://x/2\r\n');
    expect(channels.map((c) => [c.name, c.url])).toEqual([
      ['One', 'http://x/1'],
      ['Two', 'http://x/2'],
    ]);
  });

  it('accepts plain URL lists and names channels after the URL', () => {
    const { channels } = parseM3U('http://x/live/user/pass/12345.ts\nhttps://y.example/');
    expect(channels.map((c) => c.name)).toEqual(['12345', 'y.example']);
  });

  it('falls back to #EXTGRP and tvg-name', () => {
    const { channels } = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="Fallback",\n#EXTGRP:Movies\nhttp://x/1');
    expect(channels[0]).toMatchObject({ name: 'Fallback', group: 'Movies' });
  });

  it('collects request headers from #EXTVLCOPT, attributes and pipe suffixes', () => {
    const { channels } = parseM3U(
      [
        '#EXTM3U',
        '#EXTINF:-1,Vlc',
        '#EXTVLCOPT:http-user-agent=VLC/3.0',
        '#EXTVLCOPT:http-referrer=http://ref.example/',
        'http://x/1.m3u8',
        '#EXTINF:-1 http-user-agent="Attr/1.0",Attr',
        'http://x/2.m3u8',
        '#EXTINF:-1,Pipe',
        'http://x/3.m3u8|User-Agent=Pipe%2F2.0&Referer=http%3A%2F%2Fpipe.example%2F',
      ].join('\n'),
    );
    expect(channels[0]).toMatchObject({ userAgent: 'VLC/3.0', referrer: 'http://ref.example/' });
    expect(channels[1]).toMatchObject({ userAgent: 'Attr/1.0' });
    expect(channels[2]).toMatchObject({
      url: 'http://x/3.m3u8',
      userAgent: 'Pipe/2.0',
      referrer: 'http://pipe.example/',
    });
    // Options must not leak into the following entry.
    expect(channels[1]?.referrer).toBeUndefined();
  });

  it('resolves relative URLs against the playlist location', () => {
    const { channels } = parseM3U('#EXTM3U\n#EXTINF:-1,Rel\nstreams/one.m3u8', {
      baseUrl: 'https://cdn.example/lists/main.m3u',
    });
    expect(channels[0]?.url).toBe('https://cdn.example/lists/streams/one.m3u8');
  });

  it('skips protocols browsers cannot play and reports them', () => {
    const result = parseM3U('#EXTM3U\n#EXTINF:-1,Udp\nudp://@239.0.0.1:1234\n#EXTINF:-1,Ok\nhttp://x/ok.m3u8');
    expect(result.channels.map((c) => c.name)).toEqual(['Ok']);
    expect(result.unsupported).toBe(1);
  });

  it('reads guide URLs and a default EPG shift from the header', () => {
    const { channels, epgUrls } = parseM3U(
      '#EXTM3U x-tvg-url="http://a/1.xml,http://b/2.xml.gz" tvg-shift=2\n#EXTINF:-1,A\nhttp://x/a\n#EXTINF:-1 tvg-shift="-1",B\nhttp://x/b',
    );
    expect(epgUrls).toEqual(['http://a/1.xml', 'http://b/2.xml.gz']);
    expect(channels.map((c) => c.tvgShift)).toEqual([2, -1]);
  });

  it('flags radio channels and ignores unusable logos', () => {
    const { channels } = parseM3U('#EXTM3U\n#EXTINF:-1 radio="true" tvg-logo="logo.png",Radyo\nhttp://x/radio.aac');
    expect(channels[0]).toMatchObject({ radio: true });
    expect(channels[0]?.logo).toBeUndefined();
  });

  it('rejects HTML pages, non-playlists and playlists without playable entries', () => {
    const code = (text: string) => {
      try {
        parseM3U(text);
      } catch (error) {
        return error instanceof M3UError ? error.code : 'other';
      }
      return 'parsed';
    };
    expect(code('<!doctype html><html><body>Login</body></html>')).toBe('html');
    expect(code('hello world\nthis is not a playlist')).toBe('not-m3u');
    expect(code('#EXTM3U\n#EXTINF:-1,Only rtmp\nrtmp://x/live')).toBe('empty');
  });

  it('parses large playlists quickly', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 50_000; i++) {
      lines.push(`#EXTINF:-1 tvg-id="ch${i}" tvg-logo="http://logo/${i}.png" group-title="Group ${i % 40}",Channel ${i}`);
      lines.push(`http://stream.example/live/u/p/${i}.ts`);
    }
    const started = performance.now();
    const { channels } = parseM3U(lines.join('\n'));
    expect(channels).toHaveLength(50_000);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
