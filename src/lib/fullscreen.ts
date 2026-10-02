import { useSyncExternalStore } from 'react';

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type WebkitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: string) => void;
};

const doc = document as WebkitDocument;

function fullscreenElement(): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** True when the app already fills the screen (installed with display: fullscreen). */
function displayIsFullscreen(): boolean {
  return window.matchMedia('(display-mode: fullscreen)').matches;
}

export function canToggleFullscreen(video: HTMLVideoElement): boolean {
  if (displayIsFullscreen()) return false;
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled || (video as WebkitVideo).webkitEnterFullscreen);
}

/**
 * Full screen for the whole app, so the overlay UI and the channel menu stay usable. iPhones
 * only support full screen for the video element itself, so that's the fallback.
 */
export async function toggleFullscreen(video: HTMLVideoElement): Promise<void> {
  try {
    if (fullscreenElement()) {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else doc.webkitExitFullscreen?.();
      return;
    }
    const root = document.documentElement as WebkitElement;
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    else (video as WebkitVideo).webkitEnterFullscreen?.();
  } catch {
    // Rejected without a user gesture or by browser policy; nothing to do.
  }
}

function subscribeFullscreen(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  return () => {
    document.removeEventListener('fullscreenchange', onChange);
    document.removeEventListener('webkitfullscreenchange', onChange);
  };
}

export function useIsFullscreen(): boolean {
  return useSyncExternalStore(subscribeFullscreen, () => fullscreenElement() !== null);
}

export function canPictureInPicture(video: HTMLVideoElement): boolean {
  const webkit = video as WebkitVideo;
  return (
    (document.pictureInPictureEnabled && !video.disablePictureInPicture) ||
    Boolean(webkit.webkitSupportsPresentationMode?.('picture-in-picture'))
  );
}

export async function togglePictureInPicture(video: HTMLVideoElement): Promise<void> {
  const webkit = video as WebkitVideo;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (video.requestPictureInPicture && document.pictureInPictureEnabled) await video.requestPictureInPicture();
    else webkit.webkitSetPresentationMode?.(webkit.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
  } catch {
    // Not ready yet (no metadata) or refused by the browser.
  }
}
