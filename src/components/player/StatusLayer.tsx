import { List, Play, RefreshCw, RotateCw, Shield, SkipForward, TriangleAlert, Tv, VolumeX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useT, type Translate } from '../../i18n';
import { MAX_RECONNECTS } from '../../player/controller';
import type { PlaybackError } from '../../player/types';
import { openDrawer, retry, zap } from '../../store/actions';
import { useActivePlaylist, useCurrentChannel } from '../../store/hooks';
import { refreshPlaylist } from '../../store/playlists';
import { useSession } from '../../store/session';
import { toast } from '../../store/toasts';
import { ChannelLogo } from '../ChannelLogo';
import { usePlayer, usePlayerState } from './context';

/** Everything drawn over the video in the middle of the screen. */
export function StatusLayer() {
  const t = useT();
  const loadState = useSession((s) => s.loadState);
  const digits = useSession((s) => s.digits);
  const channel = useCurrentChannel();
  const controller = usePlayer();
  const state = usePlayerState();

  let center: ReactNode = null;
  if (loadState === 'loading') {
    center = <Loading label={t('player.loadingChannels')} />;
  } else if (loadState === 'missing') {
    center = <MissingData />;
  } else if (!channel) {
    center = (
      <div className="status-card">
        <Tv className="status-card__icon" aria-hidden="true" />
        <h2>{t('player.pickChannel')}</h2>
        <div className="status-card__actions">
          <button type="button" className="btn btn--primary" onClick={() => openDrawer('channels')}>
            <List aria-hidden="true" />
            {t('player.openChannels')}
          </button>
        </div>
      </div>
    );
  } else if (state.phase === 'loading') {
    center = <Loading label={t('player.connecting')} detail={channel.name} />;
  } else if (state.phase === 'reconnecting') {
    center = <Loading label={t('player.reconnecting', { attempt: state.reconnectAttempt, max: MAX_RECONNECTS })} detail={channel.name} />;
  } else if (state.phase === 'buffering') {
    center = <Loading />;
  } else if (state.phase === 'error' && state.error) {
    center = <ErrorCard error={state.error} proxyAvailable={state.proxyAvailable} />;
  } else if (state.phase === 'paused') {
    center = (
      <button type="button" className="big-play" aria-label={t('controls.play')} onClick={() => controller.togglePlay()}>
        <Play aria-hidden="true" />
      </button>
    );
  }

  const audioOnly = channel && (state.audioOnly || channel.radio) && (state.phase === 'playing' || state.phase === 'paused');

  return (
    <>
      {audioOnly && (
        <div className="audio-only" aria-hidden="true">
          <ChannelLogo channel={channel} size={132} />
          <div className="audio-only__bars">
            <span />
            <span />
            <span />
            <span />
          </div>
          <p>{t('player.audioOnly')}</p>
        </div>
      )}
      {center && <div className="status-layer">{center}</div>}
      {state.autoplayMuted && state.phase !== 'error' && (
        <button type="button" className="unmute-pill" onClick={() => controller.setMuted(false)}>
          <VolumeX aria-hidden="true" />
          {t('player.unmute')}
        </button>
      )}
      {digits && (
        <div className="digits" aria-live="assertive">
          {digits}
        </div>
      )}
    </>
  );
}

function Loading({ label, detail }: { label?: string; detail?: string }) {
  return (
    <div className="loading" role="status">
      <div className="spinner" aria-hidden="true" />
      {label && <p className="loading__label">{label}</p>}
      {detail && <p className="loading__detail">{detail}</p>}
    </div>
  );
}

function ErrorCard({ error, proxyAvailable }: { error: PlaybackError; proxyAvailable: boolean }) {
  const t = useT();
  const { message, hint } = describePlaybackError(error, t, proxyAvailable);
  const canTryProxy = proxyAvailable && !error.viaProxy && error.kind !== 'drm' && error.kind !== 'unsupported';
  const detail = [error.engine, error.status, error.detail].filter(Boolean).join(' · ');

  return (
    <div className="status-card status-card--error" role="alert">
      <TriangleAlert className="status-card__icon" aria-hidden="true" />
      <h2>{t('player.errorTitle')}</h2>
      <p>{message}</p>
      {hint && <p className="status-card__hint">{hint}</p>}
      <div className="status-card__actions">
        <button type="button" className="btn btn--primary" onClick={() => retry()}>
          <RotateCw aria-hidden="true" />
          {t('common.retry')}
        </button>
        {canTryProxy && (
          <button type="button" className="btn" onClick={() => retry({ forceProxy: true })}>
            <Shield aria-hidden="true" />
            {t('player.retryProxy')}
          </button>
        )}
        <button type="button" className="btn" onClick={() => zap(1)}>
          <SkipForward aria-hidden="true" />
          {t('player.nextChannel')}
        </button>
      </div>
      {detail && <p className="status-card__detail">{detail}</p>}
    </div>
  );
}

function MissingData() {
  const t = useT();
  const playlist = useActivePlaylist();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!playlist) return;
    setBusy(true);
    try {
      await refreshPlaylist(playlist.id);
    } catch {
      toast(t('playlists.refreshFailed'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="status-card">
      <TriangleAlert className="status-card__icon" aria-hidden="true" />
      <h2>{t('player.missingData')}</h2>
      <p>{t('player.missingDataHint')}</p>
      <div className="status-card__actions">
        {playlist?.url && (
          <button type="button" className="btn btn--primary" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw aria-hidden="true" />
            {t('playlists.refresh')}
          </button>
        )}
        <button type="button" className="btn" onClick={() => openDrawer('playlists')}>
          <List aria-hidden="true" />
          {t('tab.playlists')}
        </button>
      </div>
    </div>
  );
}

function describePlaybackError(error: PlaybackError, t: Translate, proxyAvailable: boolean): { message: string; hint?: string } {
  switch (error.kind) {
    case 'network':
      if (error.viaProxy) return { message: t('player.error.network') };
      return {
        message: t('player.error.network'),
        hint: proxyAvailable ? t('player.error.networkHint') : `${t('player.error.networkHint')} ${t('player.error.proxyHint')}`,
      };
    case 'http':
      if (error.status === 401 || error.status === 403) return { message: t('player.error.httpAuth', { status: error.status }) };
      if (error.status === 404) return { message: t('player.error.httpNotFound') };
      return { message: t('player.error.http', { status: error.status ?? '?' }) };
    case 'mixed-content':
      return { message: t('player.error.mixedContent'), hint: t('player.error.proxyHint') };
    case 'format':
      return { message: t('player.error.format') };
    case 'unsupported':
      return { message: t('player.error.unsupported') };
    case 'timeout':
      return { message: t('player.error.timeout') };
    case 'drm':
      return { message: t('player.error.drm') };
    case 'media':
      return { message: t('player.error.media') };
  }
}
