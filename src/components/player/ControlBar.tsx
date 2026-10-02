import {
  Check,
  ChevronDown,
  ChevronUp,
  Maximize,
  Minimize,
  PanelRightOpen,
  Pause,
  PictureInPicture2,
  Play,
  SlidersHorizontal,
  Star,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { formatClockTime, useLanguage, useT } from '../../i18n';
import { useBackLayer } from '../../lib/back-stack';
import { useClock } from '../../lib/clock';
import { nowNext, progressOf, scheduleFor } from '../../lib/epg/lookup';
import {
  canPictureInPicture,
  canToggleFullscreen,
  toggleFullscreen,
  togglePictureInPicture,
  useIsFullscreen,
} from '../../lib/fullscreen';
import type { Channel } from '../../lib/types';
import type { AudioTrack, EngineKind } from '../../player/types';
import { openDrawer, toggleFavorite, toggleInfo, zap } from '../../store/actions';
import { useGuide } from '../../store/guide';
import { useCurrentChannel, useFavoriteSet } from '../../store/hooks';
import { useSession } from '../../store/session';
import { ChannelLogo } from '../ChannelLogo';
import { IconButton } from '../common';
import { usePlayer, usePlayerState } from './context';
import { InfoPanel } from './InfoPanel';

export function ControlBar() {
  const t = useT();
  const controller = usePlayer();
  const state = usePlayerState();
  const channel = useCurrentChannel();
  const favorites = useFavoriteSet();
  const fullscreen = useIsFullscreen();
  const video = controller.video;
  const playing = state.phase === 'playing' || state.phase === 'buffering';
  const favorite = channel ? favorites.has(channel.url) : false;
  const hasMedia = playing || state.phase === 'paused';
  const infoOpen = useSession((s) => s.infoOpen);

  return (
    <div className="controls">
      <div className="controls__top">
        <Clock />
        <button type="button" className="menu-button" onClick={() => openDrawer('channels')}>
          <PanelRightOpen aria-hidden="true" />
          <span>{t('tab.channels')}</span>
        </button>
      </div>

      <div className="controls__bottom">
        {infoOpen && channel && (
          <div className="controls__row">
            <InfoPanel channel={channel} />
          </div>
        )}
        {!state.live && hasMedia && <Timeline />}
        {channel ? <NowPlaying channel={channel} /> : <div />}
        <div className="controls__buttons">
          <IconButton className="hide-narrow" label={t('controls.prev')} onClick={() => zap(-1)} disabled={!channel}>
            <ChevronUp />
          </IconButton>
          <IconButton className="hide-narrow" label={t('controls.next')} onClick={() => zap(1)} disabled={!channel}>
            <ChevronDown />
          </IconButton>
          <IconButton
            label={playing ? t('controls.pause') : t('controls.play')}
            onClick={() => controller.togglePlay()}
            disabled={!channel}
          >
            {playing ? <Pause /> : <Play />}
          </IconButton>
          <VolumeControl />
          {channel && (
            <IconButton
              label={favorite ? t('controls.unfavorite') : t('controls.favorite')}
              pressed={favorite}
              onClick={() => toggleFavorite(channel)}
            >
              <Star fill={favorite ? 'currentColor' : 'none'} />
            </IconButton>
          )}
          <StreamMenu />
          {canPictureInPicture(video) && (
            <IconButton label={t('controls.pip')} onClick={() => void togglePictureInPicture(video)} disabled={!hasMedia}>
              <PictureInPicture2 />
            </IconButton>
          )}
          {canToggleFullscreen(video) && (
            <IconButton
              label={fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')}
              onClick={() => void toggleFullscreen(video)}
            >
              {fullscreen ? <Minimize /> : <Maximize />}
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}

/** Channel and programme on air; opens the programme info panel. */
function NowPlaying({ channel }: { channel: Channel }) {
  const t = useT();
  const language = useLanguage();
  const state = usePlayerState();
  const guide = useGuide((s) => s.data);
  const infoOpen = useSession((s) => s.infoOpen);
  const now = useClock();
  const { current } = nowNext(scheduleFor(guide, channel), now, channel.tvgShift);
  const height = state.videoSize?.height;

  return (
    <button type="button" className="now" aria-expanded={infoOpen} title={t('guide.info')} onClick={() => toggleInfo()}>
      <ChannelLogo channel={channel} size={52} />
      <span className="now__text">
        <span className="now__title">
          <span className="now__num">{channel.num}</span>
          <span className="now__name">{channel.name}</span>
        </span>
        <span className="now__meta">
          {state.phase === 'playing' && state.live && <span className="live-badge">{t('player.live')}</span>}
          {channel.group && <span className="now__group">{channel.group}</span>}
          {height ? <span className="now__quality">{height}p</span> : null}
        </span>
        {current && (
          <span className="now__programme">
            <span className="now__time">
              {formatClockTime(current.start, language)}–{formatClockTime(current.stop, language)}
            </span>
            <span className="now__programme-title">{current.title}</span>
            <span className="now__progress" style={{ '--progress': progressOf(current, now) } as CSSProperties} />
          </span>
        )}
      </span>
    </button>
  );
}

/** Seek bar for on-demand content (movies and series in provider playlists). */
function Timeline() {
  const t = useT();
  const controller = usePlayer();
  const video = controller.video;
  const [time, setTime] = useState(() => ({ current: video.currentTime, duration: video.duration }));

  useEffect(() => {
    const update = () => setTime({ current: video.currentTime, duration: video.duration });
    const events = ['timeupdate', 'durationchange', 'seeking'];
    for (const type of events) video.addEventListener(type, update);
    return () => {
      for (const type of events) video.removeEventListener(type, update);
    };
  }, [video]);

  if (!Number.isFinite(time.duration) || time.duration <= 0) return null;
  const fill = `${(time.current / time.duration) * 100}%`;

  return (
    <div className="timeline">
      <span className="timeline__time">{formatDuration(time.current)}</span>
      <input
        type="range"
        className="timeline__slider"
        min={0}
        max={time.duration}
        step={1}
        value={time.current}
        aria-label={t('controls.seek')}
        aria-valuetext={`${formatDuration(time.current)} / ${formatDuration(time.duration)}`}
        onChange={(event) => controller.seek(Number(event.target.value))}
        style={{ '--fill': fill } as CSSProperties}
      />
      <span className="timeline__time">{formatDuration(time.duration)}</span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function Clock() {
  const language = useLanguage();
  const now = useClock();
  return (
    <time className="clock" dateTime={new Date(now).toISOString()}>
      {formatClockTime(now, language)}
    </time>
  );
}

function VolumeControl() {
  const t = useT();
  const controller = usePlayer();
  const { muted, volume } = usePlayerState();
  const silent = muted || volume === 0;
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const level = silent ? 0 : volume;

  return (
    <div className="volume">
      <IconButton
        label={silent ? t('controls.unmute') : t('controls.mute')}
        onClick={() => {
          if (!silent) controller.setMuted(true);
          else controller.setVolume(volume === 0 ? 0.5 : volume);
        }}
      >
        <Icon />
      </IconButton>
      <input
        type="range"
        className="volume__slider"
        min={0}
        max={1}
        step={0.02}
        value={level}
        aria-label={t('controls.volume')}
        onChange={(event) => controller.setVolume(Number(event.target.value))}
        style={{ '--fill': `${level * 100}%` } as CSSProperties}
      />
    </div>
  );
}

const ENGINE_NAMES: Record<EngineKind, string> = {
  hls: 'HLS · hls.js',
  mpegts: 'MPEG-TS · mpegts.js',
  native: 'Native',
};

function StreamMenu() {
  const t = useT();
  const language = useLanguage();
  const controller = usePlayer();
  const state = usePlayerState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Back (remote, gesture) closes the popup like Escape and an outside click do.
  useBackLayer(open, () => setOpen(false), 3);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const levels = [...state.levels].sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const audioLabels = audioTrackLabels(state.audioTracks, language, (n) => t('controls.track', { n }));
  const size = state.videoSize;

  return (
    <div className="menu" ref={ref}>
      <IconButton label={t('controls.streamSettings')} pressed={open} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal />
      </IconButton>
      {open && (
        <div className="menu__panel" role="dialog" aria-label={t('controls.streamSettings')}>
          {levels.length > 1 && (
            <section>
              <h3>{t('controls.quality')}</h3>
              <MenuOption selected={state.level === -1} onSelect={() => controller.setLevel(-1)}>
                {t('controls.auto')}
                {state.level === -1 && size && <small>{size.height}p</small>}
              </MenuOption>
              {levels.map((level) => (
                <MenuOption key={level.index} selected={state.level === level.index} onSelect={() => controller.setLevel(level.index)}>
                  {level.height ? `${level.height}p` : t('controls.track', { n: level.index + 1 })}
                  {level.bitrate && <small>{(level.bitrate / 1_000_000).toFixed(1)} Mbps</small>}
                </MenuOption>
              ))}
            </section>
          )}
          {state.audioTracks.length > 1 && (
            <section>
              <h3>{t('controls.audio')}</h3>
              {audioLabels.map((label, i) => {
                const track = state.audioTracks[i]!;
                return (
                  <MenuOption key={track.index} selected={state.audioTrack === track.index} onSelect={() => controller.setAudioTrack(track.index)}>
                    {label}
                  </MenuOption>
                );
              })}
            </section>
          )}
          <section>
            <h3>{t('stream.info')}</h3>
            <dl className="menu__info">
              <dt>{t('stream.engine')}</dt>
              <dd>{state.engine ? ENGINE_NAMES[state.engine] : '—'}</dd>
              <dt>{t('stream.resolution')}</dt>
              <dd>{size ? `${size.width}×${size.height}` : '—'}</dd>
              <dt>{t('stream.route')}</dt>
              <dd>{state.viaProxy ? t('stream.viaProxy') : t('stream.direct')}</dd>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * Streams often name their tracks "stream_5"; the language tag says more ("de" → "Deutsch").
 * Labels that still collide get their position appended.
 */
function audioTrackLabels(tracks: AudioTrack[], locale: string, fallback: (n: number) => string): string[] {
  const labels = tracks.map((track) => {
    const generic = !track.name || /^(stream|track|audio)[\s_-]*\d*$/i.test(track.name);
    const language = track.lang ? languageName(track.lang, locale) : undefined;
    return (generic ? language : track.name) ?? language ?? fallback(track.index + 1);
  });
  return labels.map((label, i) => (labels.indexOf(label) === labels.lastIndexOf(label) ? label : `${label} (${i + 1})`));
}

function languageName(code: string, locale: string): string | undefined {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code);
  } catch {
    return undefined;
  }
}

function MenuOption({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} className="menu__option" onClick={onSelect}>
      <Check aria-hidden="true" />
      {children}
    </button>
  );
}
