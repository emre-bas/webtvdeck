import { useEffect } from 'react';
import { back } from './back-stack';

/**
 * Arrow-key focus navigation for TV remotes, which have a D-pad but no Tab key.
 *
 * Containers opt in with `data-nav-scope`:
 *   "panel"   — menus and forms: arrows move focus to the nearest control in that direction;
 *   "overlay" — controls over the video: only while focused from the keyboard, so a button
 *               clicked with the mouse doesn't take the arrow keys away from channel zapping;
 *   "row"     — like "overlay", but only left/right (up/down keep zapping).
 * `data-nav-modal` marks a scope that takes focus when an arrow is pressed with nothing focused.
 *
 * Components handle their own keys first (lists, tabs); this runs for the keys they leave.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const DIRECTIONS: Partial<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const FOCUSABLE = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Text-like inputs: left/right move the caret until it reaches either end. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password', 'email', 'number']);

/** Overlap tolerance, so neighbours touching by a pixel or two still count as beside each other. */
const SLACK = 2;

/**
 * How far `to` lies from `from` in `direction`, or null when it isn't in that direction.
 * Elements in line with the origin win over closer ones that are off to the side.
 */
export function navDistance(from: Rect, to: Rect, direction: Direction): number | null {
  const vertical = direction === 'up' || direction === 'down';
  const gap =
    direction === 'down' ? to.top - from.bottom
    : direction === 'up' ? from.top - to.bottom
    : direction === 'right' ? to.left - from.right
    : from.left - to.right;
  if (gap < -SLACK) return null;

  const [fromStart, fromEnd, toStart, toEnd] = vertical
    ? [from.left, from.right, to.left, to.right]
    : [from.top, from.bottom, to.top, to.bottom];
  // Distance between the two elements across the direction of travel (0 when they overlap).
  const offAxis = Math.max(0, Math.max(fromStart, toStart) - Math.min(fromEnd, toEnd));
  // Tie-breaker among aligned candidates: the one closest to the origin's center.
  const centerShift = Math.abs((fromStart + fromEnd) / 2 - (toStart + toEnd) / 2);
  return Math.max(0, gap) + offAxis * 3 + centerShift * 0.01;
}

/** The sr-only file input is represented on screen by its label (the drop zone). */
function visualOf(element: HTMLElement): HTMLElement {
  return element.classList.contains('sr-only') ? (element.closest('label') ?? element) : element;
}

function isNavigable(element: HTMLElement): boolean {
  if (element.closest('[inert], [aria-hidden="true"]')) return false;
  const rect = visualOf(element).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}

function candidates(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isNavigable);
}

export function findNext(from: HTMLElement, direction: Direction, scope: Element): HTMLElement | null {
  const origin = visualOf(from).getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const element of candidates(scope)) {
    if (element === from || element.contains(from) || from.contains(element)) continue;
    const distance = navDistance(origin, visualOf(element).getBoundingClientRect(), direction);
    if (distance !== null && distance < bestDistance) {
      best = element;
      bestDistance = distance;
    }
  }
  return best;
}

export function focusElement(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  visualOf(element).scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** The element a scope starts on: its autofocus target, its selected tab, or its first control. */
export function focusDefault(scope: Element): boolean {
  const target =
    scope.querySelector<HTMLElement>('[data-autofocus]') ??
    scope.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
    candidates(scope)[0];
  if (!target) return false;
  focusElement(target);
  return true;
}

/** Whether an arrow key should leave the element rather than act inside it (caret, slider). */
function leavesElement(element: HTMLElement, direction: Direction): boolean {
  const horizontal = direction === 'left' || direction === 'right';
  if (element instanceof HTMLTextAreaElement) return false;
  if (element instanceof HTMLInputElement) {
    if (element.type === 'range') return !horizontal;
    if (TEXT_INPUT_TYPES.has(element.type) && horizontal) {
      const { selectionStart, selectionEnd, value } = element;
      // Inputs without selection support (number) only leave when empty.
      if (selectionStart === null || selectionEnd === null) return value === '';
      if (selectionStart !== selectionEnd) return false;
      return direction === 'left' ? selectionStart === 0 : selectionEnd === value.length;
    }
  }
  return true;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  if (event.key === 'Escape' || event.key === 'GoBack') {
    if (back()) event.preventDefault();
    return;
  }

  const direction = DIRECTIONS[event.key];
  if (!direction) return;

  const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const scope = active?.closest<HTMLElement>('[data-nav-scope]');
  if (!active || !scope) {
    // Nothing focused yet (or a click left focus on the page): step into the open menu.
    const modal = document.querySelector<HTMLElement>('[data-nav-modal]');
    if (modal && focusDefault(modal)) event.preventDefault();
    return;
  }

  const kind = scope.dataset.navScope;
  if (kind !== 'panel' && !active.matches(':focus-visible')) return;
  if (kind === 'row' && (direction === 'up' || direction === 'down')) return;
  if (!leavesElement(active, direction)) return;

  const next = findNext(active, direction, scope);
  if (next) {
    focusElement(next);
    event.preventDefault();
  } else if (kind !== 'panel') {
    // Nowhere to go: don't let the key fall through to channel zapping.
    event.preventDefault();
  }
}

/**
 * Installs remote/keyboard navigation for the whole app. Runs on `document`, after React's
 * handlers (so components can claim keys first) and before the player shortcuts on `window`.
 */
export function useRemoteNavigation(): void {
  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
