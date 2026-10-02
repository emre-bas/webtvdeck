import { useCallback, useEffect, useRef, useState } from 'react';
import { toggleFullscreen } from '../../lib/fullscreen';
import { PlayerController } from '../../player/controller';
import { openDrawer, openPlaylist, toggleInfo, zap } from '../../store/actions';
import { getProxyConfig } from '../../store/proxy';
import { useLibrary } from '../../store/library';
import { useSession } from '../../store/session';
import { Drawer } from '../drawer/Drawer';
import { PlayerContext, usePlayer, usePlayerState } from './context';
import { ControlBar } from './ControlBar';
import { useIdle, useKeyboardShortcuts, useMediaSession, usePersistVolume, usePlaybackRequests } from './hooks';
import { StatusLayer } from './StatusLayer';
import './player.css';

export function PlayerScreen({ playlistId }: { playlistId: string }) {
  const [controller, setController] = useState<PlayerController | null>(null);

  const attachVideo = useCallback((video: HTMLVideoElement) => {
    const { volume, muted } = useLibrary.getState().settings;
    video.volume = volume;
    video.muted = muted;
    const instance = new PlayerController(video, getProxyConfig);
    setController(instance);
    return () => {
      instance.destroy();
      setController(null);
    };
  }, []);

  useEffect(() => {
    void openPlaylist(playlistId);
  }, [playlistId]);

  return (
    <div className="player">
      <video ref={attachVideo} className="player__video" playsInline preload="auto" />
      {controller && (
        <PlayerContext value={controller}>
          <PlayerUi />
        </PlayerContext>
      )}
    </div>
  );
}

function PlayerUi() {
  const controller = usePlayer();
  const state = usePlayerState();
  const request = useSession((s) => s.request);
  const drawerOpen = useSession((s) => s.drawerOpen);
  const infoOpen = useSession((s) => s.infoOpen);
  const { idle, wake, sleep } = useIdle(3500);

  usePlaybackRequests(controller, request);
  useKeyboardShortcuts(controller);
  useMediaSession(controller, request);
  usePersistVolume(state);

  // Show the info bar briefly whenever the channel changes.
  useEffect(() => {
    if (request) wake();
  }, [request, wake]);

  // Keep the controls up while nothing is playing (loading, paused, errors) or info is open.
  const settled = state.phase === 'playing' || state.phase === 'buffering';
  const hidden = idle && settled && !drawerOpen && !infoOpen;

  function onTap(pointerType: string) {
    if (infoOpen) toggleInfo(false);
    else if (pointerType === 'mouse' || hidden) wake();
    else sleep();
  }

  return (
    <div className="player__ui" data-idle={hidden || undefined} data-drawer={drawerOpen || undefined}>
      <Stage onTap={onTap} />
      <StatusLayer />
      <ControlBar />
      <Drawer />
    </div>
  );
}

/**
 * Transparent layer over the video for pointer gestures: tap toggles the controls,
 * double-click toggles full screen, swipe left opens the channel list and vertical swipes
 * zap like a TV remote.
 */
function Stage({ onTap }: { onTap: (pointerType: string) => void }) {
  const controller = usePlayer();
  const start = useRef<{ x: number; y: number; time: number; id: number; type: string } | null>(null);

  return (
    <div
      className="stage"
      onPointerDown={(event) => {
        start.current = { x: event.clientX, y: event.clientY, time: event.timeStamp, id: event.pointerId, type: event.pointerType };
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onPointerUp={(event) => {
        const origin = start.current;
        start.current = null;
        if (!origin || origin.id !== event.pointerId) return;

        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        const distanceX = Math.abs(dx);
        const distanceY = Math.abs(dy);
        if (distanceX < 12 && distanceY < 12) {
          onTap(origin.type);
          return;
        }
        if (origin.type === 'mouse' || event.timeStamp - origin.time > 800) return;
        if (dx < -60 && distanceX > distanceY * 1.5) openDrawer('channels');
        else if (distanceY > 60 && distanceY > distanceX * 1.5) zap(dy < 0 ? 1 : -1);
      }}
      onDoubleClick={() => void toggleFullscreen(controller.video)}
    />
  );
}
