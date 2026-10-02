import { History, ListVideo, Settings, Star, Tv, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useT, type MessageKey } from '../../i18n';
import { back, useBackLayer } from '../../lib/back-stack';
import { closeDrawer, openDrawer } from '../../store/actions';
import { useActivePlaylist } from '../../store/hooks';
import { useSession, type DrawerTab } from '../../store/session';
import { IconButton } from '../common';
import { Logo } from '../Logo';
import { ChannelsPanel } from './ChannelsPanel';
import { FavoritesPanel } from './FavoritesPanel';
import { HistoryPanel } from './HistoryPanel';
import { PlaylistsPanel } from './PlaylistsPanel';
import { SettingsPanel } from './SettingsPanel';
import './drawer.css';

const TABS: { id: DrawerTab; icon: LucideIcon; label: MessageKey }[] = [
  { id: 'channels', icon: Tv, label: 'tab.channels' },
  { id: 'favorites', icon: Star, label: 'tab.favorites' },
  { id: 'history', icon: History, label: 'tab.history' },
  { id: 'playlists', icon: ListVideo, label: 'tab.playlists' },
  { id: 'settings', icon: Settings, label: 'tab.settings' },
];

const BACK_KEYS = new Set(['Escape', 'GoBack', 'BrowserBack']);

/** The menu that slides in from the right, over the playing video. */
export function Drawer() {
  const t = useT();
  const open = useSession((s) => s.drawerOpen);
  const tab = useSession((s) => s.drawerTab);
  const playlist = useActivePlaylist();
  const drawerRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);

  // Back (remote, gesture) closes the menu instead of leaving the app; views inside it close first.
  useBackLayer(open, closeDrawer);

  // Focus moves into the drawer when it opens (so arrow keys work right away) and leaves it on close.
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    if (open) {
      const target =
        drawer.querySelector<HTMLElement>('.drawer__body [data-autofocus]') ??
        drawer.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      target?.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement && drawer.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (BACK_KEYS.has(event.key) && !event.defaultPrevented) {
      event.preventDefault();
      // A view inside the menu (group picker, playlist form) closes first.
      if (!back()) closeDrawer();
    }
  }

  function onTabsKeyDown(event: KeyboardEvent) {
    const position = TABS.findIndex((item) => item.id === tab);
    let next: DrawerTab | undefined;
    if (event.key === 'ArrowRight') next = TABS[(position + 1) % TABS.length]?.id;
    else if (event.key === 'ArrowLeft') next = TABS[(position - 1 + TABS.length) % TABS.length]?.id;
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      drawerRef.current?.querySelector<HTMLElement>('.drawer__body [data-autofocus], .drawer__body input, .drawer__body button')?.focus();
      return;
    }
    if (!next) return;
    event.preventDefault();
    openDrawer(next);
    tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  return (
    <>
      <div className="scrim" data-open={open || undefined} onClick={closeDrawer} aria-hidden="true" />
      <aside
        ref={drawerRef}
        className="drawer"
        data-open={open || undefined}
        aria-label={t('drawer.label')}
        aria-hidden={!open}
        inert={!open}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse') swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
        }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) closeDrawer();
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <header className="drawer__header">
          <Logo size={30} />
          <div className="drawer__title">
            <span className="drawer__brand">{__APP_NAME__}</span>
            {playlist && <span className="drawer__playlist">{playlist.name}</span>}
          </div>
          <IconButton label={t('common.close')} onClick={closeDrawer}>
            <X />
          </IconButton>
        </header>

        <div className="drawer__tabs" role="tablist" ref={tabsRef} onKeyDown={onTabsKeyDown}>
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`drawer-tab-${id}`}
              data-tab={id}
              aria-selected={tab === id}
              aria-controls="drawer-panel"
              tabIndex={tab === id ? 0 : -1}
              className="drawer__tab"
              onClick={() => openDrawer(id)}
            >
              <Icon aria-hidden="true" />
              <span>{t(label)}</span>
            </button>
          ))}
        </div>

        <div className="drawer__body" role="tabpanel" id="drawer-panel" aria-labelledby={`drawer-tab-${tab}`}>
          {tab === 'channels' && <ChannelsPanel />}
          {tab === 'favorites' && <FavoritesPanel />}
          {tab === 'history' && <HistoryPanel />}
          {tab === 'playlists' && <PlaylistsPanel />}
          {tab === 'settings' && <SettingsPanel />}
        </div>
      </aside>
    </>
  );
}
