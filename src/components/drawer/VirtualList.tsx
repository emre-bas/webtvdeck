import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';

export interface VirtualListHandle {
  focus(): void;
}

interface VirtualListProps<T> {
  items: readonly T[];
  rowHeight: number;
  label: string;
  /** Prefix for option ids (aria-activedescendant). */
  idPrefix: string;
  renderRow: (item: T, index: number) => ReactNode;
  onActivate: (item: T, index: number) => void;
  /** Row to highlight and scroll into view whenever the list changes (e.g. the playing channel). */
  initialIndex?: number;
  autoFocus?: boolean;
  /** Arrow up on the first row. */
  onExitTop?: () => void;
  /** A printable key was pressed on the list (to start a search). */
  onTypeAhead?: () => void;
  empty?: ReactNode;
  ref?: Ref<VirtualListHandle>;
}

/**
 * Virtualized listbox: renders only the visible rows, so lists with tens of thousands of
 * channels scroll smoothly, and it is fully usable with arrow keys (keyboards, TV remotes).
 */
export function VirtualList<T>({
  items,
  rowHeight,
  label,
  idPrefix,
  renderRow,
  onActivate,
  initialIndex = -1,
  autoFocus = false,
  onExitTop,
  onTypeAhead,
  empty,
  ref,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(Math.max(initialIndex, 0));
  // oxlint-disable-next-line react/incompatible-library -- the app doesn't use the React Compiler
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  useImperativeHandle(ref, () => ({ focus: () => scrollRef.current?.focus({ preventScroll: true }) }), []);

  useEffect(() => {
    if (autoFocus) scrollRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    const target = initialIndex >= 0 && initialIndex < items.length ? initialIndex : 0;
    setActive(target);
    if (!items.length) return;
    // A fresh list centers the playing channel; one the user has scrolled only moves if needed.
    const fresh = (scrollRef.current?.scrollTop ?? 0) === 0;
    virtualizer.scrollToIndex(target, { align: fresh && initialIndex >= 0 ? 'center' : 'auto' });
  }, [items, initialIndex, virtualizer]);

  function move(index: number) {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setActive(next);
    virtualizer.scrollToIndex(next, { align: 'auto' });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? rowHeight) / rowHeight) - 1);
    switch (event.key) {
      case 'ArrowDown':
        move(active + 1);
        break;
      case 'ArrowUp':
        if (active === 0 && onExitTop) onExitTop();
        else move(active - 1);
        break;
      case 'PageDown':
        move(active + page);
        break;
      case 'PageUp':
        move(active - page);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(items.length - 1);
        break;
      case 'Enter':
      case ' ': {
        const item = items[active];
        if (item !== undefined) onActivate(item, active);
        break;
      }
      default:
        // Let the character land in the search field that receives focus.
        if (onTypeAhead && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) onTypeAhead();
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  if (!items.length) return <div className="vlist-empty">{empty}</div>;

  return (
    <div
      ref={scrollRef}
      className="vlist"
      role="listbox"
      aria-label={label}
      tabIndex={0}
      data-autofocus
      aria-activedescendant={`${idPrefix}-${active}`}
      onKeyDown={onKeyDown}
    >
      <div className="vlist__inner" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index]!;
          return (
            <div
              key={row.key}
              id={`${idPrefix}-${row.index}`}
              role="option"
              aria-selected={row.index === active}
              className="vlist__row"
              data-active={row.index === active || undefined}
              style={{ height: rowHeight, transform: `translateY(${row.start}px)` }}
              onClick={() => {
                setActive(row.index);
                onActivate(item, row.index);
              }}
            >
              {renderRow(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
