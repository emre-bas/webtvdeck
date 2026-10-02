import { useCallback, useEffect, useRef, useState } from 'react';
import { toggleFullscreen, togglePictureInPicture } from '../../lib/fullscreen';
import type { PlayerController } from '../../player/controller';
import { closeDrawer, commitDigits, openDrawer, recall, toggleInfo, typeDigit, zap } from '../../store/actions';
import { useLibrary } from '../../store/library';
import { useSession, type PlayRequest } from '../../store/session';
import type { PlayerState } from '../../player/controller';

/** Short delay so that holding channel up/down doesn't open every stream on the way. */
const ZAP_SETTLE_MS = 150;

export function usePlaybackRequests(controller: PlayerController, request: PlayRequest | null): void {
  useEffect(() => {
    if (!request) {
      controller.stop();
      return;
    }
    const { channel, forceProxy } = request;
    const timer = window.setTimeout(() => {
      void controller.play({ url: channel.url, userAgent: channel.userAgent, referrer: channel.referrer }, { forceProxy });
    }, ZAP_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [controller, request]);
}

/** Hides the controls and the cursor after a period without mouse or keyboard activity. */
export function useIdle(timeoutMs: number) {
  const [idle, setIdle] = useState(false);
  const timer = useRef(0);

  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), timeoutMs);
  }, [timeoutMs]);

  const sleep = useCallback(() => {
    window.clearTimeout(timer.current);
    setIdle(true);
  }, []);

  useEffect(() => {
    // Touch input is handled explicitly (a tap toggles the controls).
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') wake();
    };
    window.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', wake);
    window.addEventListener('wheel', wake, { passive: true });
    timer.current = window.setTimeout(() => setIdle(true), timeoutMs);
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('wheel', wake);
      window.clearTimeout(timer.current);
    };
  }, [wake, timeoutMs]);

  return { idle, wake, sleep };
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** TV-style keys: arrows zap, Enter opens the list, digits pick a channel number. */
export function useKeyboardShortcuts(controller: PlayerController): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;

      if (useSession.getState().drawerOpen) {
        if (event.key === 'Escape' || event.key === 'GoBack' || event.key === 'BrowserBack') {
          closeDrawer();
          event.preventDefault();
        }
        return;
      }

      const onButton = event.target instanceof HTMLButtonElement;
      switch (event.key) {
        case 'ArrowUp':
        case 'PageUp':
        case 'ChannelDown':
          zap(-1);
          break;
        case 'ArrowDown':
        case 'PageDown':
        case 'ChannelUp':
          zap(1);
          break;
        case 'Enter':
          if (onButton) return;
          if (!commitDigits()) openDrawer('channels');
          break;
        case 'ArrowRight':
        case 'c':
        case 'C':
        case 'ContextMenu':
          openDrawer('channels');
          break;
        case ' ':
          if (onButton) return;
          controller.togglePlay();
          break;
        case 'k':
        case 'K':
        case 'MediaPlayPause':
          controller.togglePlay();
          break;
        case 'm':
        case 'M':
          controller.setMuted(!controller.video.muted);
          break;
        case 'f':
        case 'F':
          void toggleFullscreen(controller.video);
          break;
        case 'p':
        case 'P':
          void togglePictureInPicture(controller.video);
          break;
        case 'l':
        case 'L':
        case 'Backspace':
          recall();
          break;
        case 'i':
        case 'I':
        case 'Info':
          toggleInfo();
          break;
        case 'Escape':
          if (!useSession.getState().infoOpen) return;
          toggleInfo(false);
          break;
        default:
          if (/^\d$/.test(event.key)) {
            typeDigit(event.key);
            break;
          }
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);
}

/** OS media controls and hardware media keys (next/previous track zap channels). */
export function useMediaSession(controller: PlayerController, request: PlayRequest | null): void {
  const channel = request?.channel;

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = channel
      ? new MediaMetadata({
          title: channel.name,
          artist: channel.group ?? __APP_NAME__,
          artwork: channel.logo ? [{ src: channel.logo }] : [],
        })
      : null;
  }, [channel]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void controller.video.play().catch(() => {})],
      ['pause', () => controller.video.pause()],
      ['nexttrack', () => zap(1)],
      ['previoustrack', () => zap(-1)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Ignore.
        }
      }
    };
  }, [controller]);
}

/** Remembers volume and mute across sessions (but not the mute forced by autoplay rules). */
export function usePersistVolume(state: PlayerState): void {
  const { muted, volume, autoplayMuted } = state;
  useEffect(() => {
    if (autoplayMuted) return;
    const timer = window.setTimeout(() => useLibrary.getState().updateSettings({ muted, volume }), 300);
    return () => window.clearTimeout(timer);
  }, [muted, volume, autoplayMuted]);
}
