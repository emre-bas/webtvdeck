import { ArrowLeft, CalendarClock, Check, ListVideo, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatRelativeTime, useLanguage, useT } from '../../i18n';
import { useBackLayer } from '../../lib/back-stack';
import { FetchTextError } from '../../lib/fetch-text';
import type { PlaylistMeta } from '../../lib/types';
import { guideUrlOf, refreshGuide, useGuide } from '../../store/guide';
import { useLibrary } from '../../store/library';
import { deletePlaylist, demoUrl, refreshPlaylist } from '../../store/playlists';
import { useSession } from '../../store/session';
import { toast } from '../../store/toasts';
import { IconButton } from '../common';
import { PlaylistForm } from '../PlaylistForm';

/** `focus` names the control to return to: "add" or a playlist id. */
type View = { kind: 'list'; focus?: string } | { kind: 'add' } | { kind: 'edit'; id: string };

export function PlaylistsPanel() {
  const t = useT();
  const playlists = useLibrary((s) => s.playlists);
  const activeId = useLibrary((s) => s.activePlaylistId);
  const drawerOpen = useSession((s) => s.drawerOpen);
  const [view, setView] = useState<View>({ kind: 'list' });
  const listRef = useRef<HTMLDivElement>(null);
  const editing = view.kind === 'edit' ? playlists.find((p) => p.id === view.id) : undefined;
  const subview = view.kind === 'add' || editing !== undefined;

  function showList() {
    setView({ kind: 'list', focus: view.kind === 'edit' ? view.id : view.kind === 'add' ? 'add' : undefined });
  }

  // Back (remote, gesture) and Escape return to the list before closing the menu.
  useBackLayer(drawerOpen && subview, showList, 2);

  // Coming back from a form, focus returns to the button that opened it (remote navigation).
  useEffect(() => {
    if (view.kind !== 'list' || !view.focus) return;
    listRef.current?.querySelector<HTMLElement>(`[data-return-focus="${CSS.escape(view.focus)}"]`)?.focus();
  }, [view]);

  if (view.kind === 'add') {
    // Touch screens and TVs would pop up their keyboard right away; start them on the back button.
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    return (
      <Subview title={t('playlists.add')} onBack={showList} focusBack={!finePointer}>
        <PlaylistForm autoFocus={finePointer} showDemo onSaved={showList} />
      </Subview>
    );
  }

  if (editing) {
    return (
      <Subview title={t('playlists.editTitle')} onBack={showList} focusBack>
        <PlaylistForm key={editing.id} playlist={editing} onSaved={showList} />
        <button
          type="button"
          className="btn btn--danger btn--block"
          onClick={() => {
            if (!window.confirm(t('playlists.deleteConfirm', { name: editing.name }))) return;
            void deletePlaylist(editing.id);
            setView({ kind: 'list' });
          }}
        >
          <Trash2 aria-hidden="true" />
          {t('playlists.deleteList')}
        </button>
      </Subview>
    );
  }

  return (
    <div className="panel panel--scroll" ref={listRef}>
      <ul className="playlists">
        {playlists.map((playlist) => (
          <PlaylistCard
            key={playlist.id}
            playlist={playlist}
            active={playlist.id === activeId}
            onEdit={() => setView({ kind: 'edit', id: playlist.id })}
          />
        ))}
      </ul>

      <button type="button" className="btn btn--block" data-return-focus="add" onClick={() => setView({ kind: 'add' })}>
        <Plus aria-hidden="true" />
        {t('playlists.add')}
      </button>
    </div>
  );
}

function Subview({ title, onBack, focusBack, children }: { title: string; onBack: () => void; focusBack: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <div className="panel panel--scroll">
      <header className="subview-head">
        <IconButton label={t('common.back')} onClick={onBack} autoFocus={focusBack}>
          <ArrowLeft />
        </IconButton>
        <h3>{title}</h3>
      </header>
      {children}
    </div>
  );
}

function PlaylistCard({ playlist, active, onEdit }: { playlist: PlaylistMeta; active: boolean; onEdit: () => void }) {
  const t = useT();
  const language = useLanguage();
  const setActivePlaylist = useLibrary((s) => s.setActivePlaylist);
  const [refreshing, setRefreshing] = useState(false);

  // Show the host only: provider URLs usually carry the username and password.
  const source = playlist.url ? hostOf(playlist.url) : (playlist.fileName ?? t('playlists.fromFile'));

  async function refresh() {
    setRefreshing(true);
    try {
      const updated = await refreshPlaylist(playlist.id);
      toast(t('playlists.refreshed', { count: updated.channelCount }), { tone: 'success' });
    } catch (error) {
      const reason = error instanceof FetchTextError && error.status ? ` (${error.status})` : '';
      toast(`${t('playlists.refreshFailed')}${reason}`, { tone: 'error' });
    } finally {
      setRefreshing(false);
    }
  }

  function remove() {
    if (window.confirm(t('playlists.deleteConfirm', { name: playlist.name }))) void deletePlaylist(playlist.id);
  }

  return (
    <li className="playlist" data-active={active || undefined}>
      <button
        type="button"
        className="playlist__main"
        onClick={() => setActivePlaylist(playlist.id)}
        disabled={active}
        title={active ? undefined : t('playlists.switch')}
      >
        <span className="playlist__icon">{active ? <Check aria-hidden="true" /> : <ListVideo aria-hidden="true" />}</span>
        <span className="playlist__text">
          <span className="playlist__name">
            <span className="playlist__title">{playlist.name}</span>
            {active && <span className="badge">{t('playlists.active')}</span>}
          </span>
          <span className="playlist__meta">
            {t('channels.count', { count: playlist.channelCount })} · {t('playlists.groupCount', { count: playlist.groupCount })}
          </span>
          <span className="playlist__meta">
            {source} · {t('playlists.updated', { time: formatRelativeTime(playlist.updatedAt, language) })}
          </span>
        </span>
      </button>

      <div className="playlist__actions">
        {playlist.url && (
          <IconButton label={t('playlists.refresh')} onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'spin' : undefined} />
          </IconButton>
        )}
        <IconButton label={t('playlists.edit')} onClick={onEdit} data-return-focus={playlist.id}>
          <Pencil />
        </IconButton>
        <IconButton label={t('playlists.delete')} onClick={remove}>
          <Trash2 />
        </IconButton>
      </div>

      {playlist.url === demoUrl() && <DemoCredit />}
      {active && <GuideStatus playlist={playlist} />}
    </li>
  );
}

/** The credit the demo films' CC BY 3.0 license asks for, next to the playlist that plays them. */
function DemoCredit() {
  return (
    <p className="playlist__credit">
      <a href="https://www.bigbuckbunny.org" target="_blank" rel="noreferrer">
        Big Buck Bunny
      </a>
      ,{' '}
      <a href="https://mango.blender.org" target="_blank" rel="noreferrer">
        Tears of Steel
      </a>
      : © Blender Foundation,{' '}
      <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">
        CC BY 3.0
      </a>
    </p>
  );
}

function GuideStatus({ playlist }: { playlist: PlaylistMeta }) {
  const t = useT();
  const language = useLanguage();
  const { updating, fetchedAt, programmes, error } = useGuide();
  const url = guideUrlOf(playlist);

  let status: string;
  if (!url) status = t('guide.none');
  else if (updating) status = t('guide.updating');
  else if (fetchedAt) status = t('guide.status', { count: programmes, time: formatRelativeTime(fetchedAt, language) });
  else if (error) status = error.status ? `${t('guide.failed')} (${error.status})` : t('guide.failed');
  else status = t('guide.updating');

  return (
    <div className="playlist__guide">
      <CalendarClock aria-hidden="true" />
      <span className="playlist__guide-status" data-error={(!!error && !updating) || undefined}>
        {status}
      </span>
      {url && (
        <button
          type="button"
          className="btn btn--small"
          disabled={updating}
          onClick={() => void refreshGuide(playlist.id, useSession.getState().channels)}
        >
          {t('guide.refresh')}
        </button>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
