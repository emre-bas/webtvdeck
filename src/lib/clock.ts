import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer = 0;

function tick(): void {
  now = Date.now();
  for (const listener of listeners) listener();
  // Aligned to :00 and :30 so the minute display flips on time.
  timer = window.setTimeout(tick, TICK_MS - (Date.now() % TICK_MS));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (Date.now() - now >= TICK_MS) tick();
    else timer = window.setTimeout(tick, TICK_MS - (Date.now() % TICK_MS));
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.clearTimeout(timer);
  };
}

/** Current time, refreshed every 30 seconds by one timer shared by all subscribers. */
export function useClock(): number {
  return useSyncExternalStore(subscribe, () => now);
}
