import { useEffect, useRef } from 'react';

/**
 * Makes Back (the Android back gesture, a TV remote's BACK button, the browser's back button)
 * close the topmost open layer — a popup, a panel, the menu — instead of leaving the app.
 *
 * Every open layer owns one history entry on top of the app's own, so each Back press lands
 * on the entry below and closes exactly one layer. Layers closed from the UI give their entry
 * back with history.go(), so the history never collects stale entries.
 */

interface Layer {
  level: number;
  close: () => void;
}

/** Open layers, bottom first (sorted by level, then by opening order). */
const layers: Layer[] = [];
/** Layer depth of the history entry we're on, or heading to while a traversal is pending. */
let depth = depthOf(history.state);
let syncTimer = 0;

function depthOf(state: unknown): number {
  const value = (state as { layerDepth?: unknown } | null)?.layerDepth;
  return typeof value === 'number' ? value : 0;
}

/** Brings the history entries in line with the open layers once the current render settled. */
function scheduleSync(): void {
  syncTimer ||= window.setTimeout(() => {
    syncTimer = 0;
    if (depth < layers.length) {
      while (depth < layers.length) history.pushState({ ...history.state, layerDepth: ++depth }, '');
    } else if (depth > layers.length) {
      const steps = layers.length - depth;
      depth = layers.length;
      history.go(steps);
    }
  }, 0);
}

window.addEventListener('popstate', (event) => {
  depth = depthOf(event.state);
  // Back closes the layers above the entry we landed on (normally just the top one).
  while (layers.length > depth) layers.pop()!.close();
  scheduleSync();
});

/**
 * Registers a layer while `open` is true; `close` runs when Back is pressed with this layer on
 * top. Higher levels sit above lower ones (menu 1, a view inside the menu 2, a popup 3); level 0
 * is reserved for the guard that asks before leaving the app.
 */
export function useBackLayer(open: boolean, close: () => void, level = 1): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    const layer: Layer = { level, close: () => closeRef.current() };
    const index = layers.findIndex((other) => other.level > level);
    layers.splice(index === -1 ? layers.length : index, 0, layer);
    scheduleSync();
    return () => {
      const position = layers.indexOf(layer);
      if (position !== -1) layers.splice(position, 1);
      scheduleSync();
    };
  }, [open, level]);
}

/** Escape key: closes the topmost layer (but never triggers the exit guard). */
export function back(): boolean {
  const top = layers.at(-1);
  if (!top || top.level === 0) return false;
  layers.pop();
  top.close();
  scheduleSync();
  return true;
}
