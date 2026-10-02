import { describe, expect, it } from 'vitest';
import type { Channel } from '../types';
import { nowNext, scheduleFor, upcoming } from './lookup';
import { channelKey, GuideCollector, parseXmltvTime, type GuideFilter } from './xmltv';

const T = (iso: string) => Date.parse(iso);

const GUIDE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="test">
  <channel id="TRT1.tr"><display-name lang="tr">TRT 1</display-name><icon src="http://x/trt1.png"/></channel>
  <channel id="atv.tr"><display-name>ATV</display-name><display-name>ATV HD</display-name></channel>
  <channel id="other.de"><display-name>Das Erste</display-name></channel>
  <programme start="20261001180000 +0300" stop="20261001190000 +0300" channel="TRT1.tr">
    <title lang="tr">Ana Haber &amp; Hava Durumu</title>
    <desc lang="tr">Günün   önemli
      gelişmeleri.</desc>
    <category>Haber</category>
  </programme>
  <programme start="20261001190000 +0300" stop="20261001203000 +0300" channel="TRT1.tr">
    <title><![CDATA[Dizi: <Kuruluş>]]></title>
  </programme>
  <programme start="20261001160000 +0000" channel="atv.tr"><title>Film</title></programme>
  <programme start="20261001170000 +0000" channel="atv.tr"><title>Haber</title></programme>
  <programme start="20261001170000 +0000" stop="20261001180000 +0000" channel="other.de"><title>Tagesschau</title></programme>
  <programme start="20261003170000 +0000" stop="20261003180000 +0000" channel="TRT1.tr"><title>Too late</title></programme>
</tv>`;

const FILTER: GuideFilter = {
  ids: ['trt1.tr'],
  names: [channelKey('TR: ATV HD')],
  from: T('2026-10-01T00:00:00Z'),
  to: T('2026-10-02T12:00:00Z'),
};

function collect(text: string, chunkSize = text.length, filter = FILTER) {
  const collector = new GuideCollector(filter);
  for (let i = 0; i < text.length; i += chunkSize) collector.push(text.slice(i, i + chunkSize));
  return { collector, data: collector.finish() };
}

describe('parseXmltvTime', () => {
  it('applies the UTC offset', () => {
    expect(parseXmltvTime('20261001180000 +0300')).toBe(T('2026-10-01T15:00:00Z'));
    expect(parseXmltvTime('20261001180000 -0130')).toBe(T('2026-10-01T19:30:00Z'));
    expect(parseXmltvTime('202610011800')).toBe(T('2026-10-01T18:00:00Z'));
    expect(parseXmltvTime('garbage')).toBeNull();
  });
});

describe('channelKey', () => {
  it('ignores country prefixes, quality tags, case and punctuation', () => {
    expect(channelKey('TR: TRT 1 HD')).toBe('trt1');
    expect(channelKey('trt-1')).toBe('trt1');
    expect(channelKey('İZMİR TV FHD')).toBe('izmirtv');
  });
});

describe('GuideCollector', () => {
  it('keeps wanted channels inside the window and decodes text', () => {
    const { collector, data } = collect(GUIDE);
    expect(collector.recognized).toBe(true);
    expect(Object.keys(data.programmes).sort()).toEqual(['atv.tr', 'trt1.tr']);
    expect(data.aliases).toEqual({ atv: 'atv.tr' });

    const trt = data.programmes['trt1.tr']!;
    expect(trt.map((p) => p.title)).toEqual(['Ana Haber & Hava Durumu', 'Dizi: <Kuruluş>']);
    expect(trt[0]).toMatchObject({
      start: T('2026-10-01T15:00:00Z'),
      stop: T('2026-10-01T16:00:00Z'),
      desc: 'Günün önemli gelişmeleri.',
      category: 'Haber',
    });
  });

  it('closes programmes without a stop time at the next start', () => {
    const { data } = collect(GUIDE);
    const atv = data.programmes['atv.tr']!;
    expect(atv[0]!.stop).toBe(T('2026-10-01T17:00:00Z'));
    expect(atv[1]!.stop).toBe(T('2026-10-01T18:00:00Z'));
  });

  it('produces the same result regardless of chunk boundaries', () => {
    const whole = collect(GUIDE).data;
    for (const size of [1, 7, 64]) expect(collect(GUIDE, size).data).toEqual(whole);
  });

  it('does not recognize non-guide documents', () => {
    const { collector } = collect('<html><body>Service unavailable</body></html>');
    expect(collector.recognized).toBe(false);
  });
});

describe('lookup', () => {
  const { data } = collect(GUIDE);
  const trt: Channel = { url: 'http://x/1', name: 'TRT 1 HD', num: 1, tvgId: 'TRT1.tr' };
  const atv: Channel = { url: 'http://x/2', name: 'TR: ATV HD', num: 2 };

  it('finds schedules by tvg-id and by name', () => {
    expect(scheduleFor(data, trt)).toHaveLength(2);
    expect(scheduleFor(data, atv)).toHaveLength(2);
    expect(scheduleFor(data, { url: 'u', name: 'Unknown', num: 3 })).toBeUndefined();
  });

  it('returns the current and next programme', () => {
    const at = T('2026-10-01T15:30:00Z');
    const { current, next } = nowNext(scheduleFor(data, trt), at);
    expect(current?.title).toBe('Ana Haber & Hava Durumu');
    expect(next?.title).toBe('Dizi: <Kuruluş>');
    expect(nowNext(scheduleFor(data, trt), T('2026-10-01T12:00:00Z')).current).toBeUndefined();
    expect(upcoming(scheduleFor(data, trt), at).map((p) => p.title)).toEqual(['Dizi: <Kuruluş>']);
  });

  it('applies tvg-shift', () => {
    // Guide times are one hour early for this channel: at 16:30Z the 15:00Z show is still on.
    const { current } = nowNext(scheduleFor(data, trt), T('2026-10-01T16:30:00Z'), 1);
    expect(current?.title).toBe('Ana Haber & Hava Durumu');
    expect(current?.start).toBe(T('2026-10-01T16:00:00Z'));
  });
});
