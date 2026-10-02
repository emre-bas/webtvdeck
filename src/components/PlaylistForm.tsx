import { ChevronRight, CircleAlert, FileUp, Link, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useT, type Translate } from '../i18n';
import { FetchTextError } from '../lib/fetch-text';
import { M3UError } from '../lib/m3u';
import { formatBytes, isHttpUrl } from '../lib/text';
import type { PlaylistMeta } from '../lib/types';
import { useLibrary } from '../store/library';
import {
  demoUrl,
  findPlaylistByUrl,
  importPlaylist,
  savePlaylist,
  type ImportProgress,
  type PlaylistFields,
  type PlaylistSource,
} from '../store/playlists';
import { toast } from '../store/toasts';
import { Segmented } from './common';
import './PlaylistForm.css';

type Mode = 'url' | 'file';

interface Props {
  /** The playlist to edit; without one the form adds a new playlist. */
  playlist?: PlaylistMeta;
  onSaved?: (playlist: PlaylistMeta) => void;
  autoFocus?: boolean;
  /** Offer the demo playlist (until it's in the library). */
  showDemo?: boolean;
}

/** Adds a playlist, or edits every part of an existing one: source, name, guide, User-Agent. */
export function PlaylistForm({ playlist, onSaved, autoFocus = false, showDemo = false }: Props) {
  const t = useT();
  const editing = playlist !== undefined;
  const [mode, setMode] = useState<Mode>(playlist?.fileName && !playlist.url ? 'file' : 'url');
  const [url, setUrl] = useState(playlist?.url ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(playlist?.name ?? '');
  const [guideUrl, setGuideUrl] = useState(playlist?.epgOverride ?? '');
  const [userAgent, setUserAgent] = useState(playlist?.userAgent ?? '');
  const [advanced, setAdvanced] = useState(Boolean(playlist?.epgOverride || playlist?.userAgent));
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasPlaylists = useLibrary((s) => s.playlists.length > 0);
  const demoAdded = useLibrary((s) => s.playlists.some((p) => p.url === demoUrl()));
  const busy = progress !== null;
  // A playlist added from a file can be saved without picking the file again.
  const currentFile = editing && !playlist.url ? playlist.fileName : undefined;
  const canSubmit = mode === 'url' ? url.trim() !== '' : file !== null || currentFile !== undefined;

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run(source: PlaylistSource | undefined, fields: PlaylistFields) {
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setProgress({ stage: source ? 'download' : 'save' });
    try {
      const result = playlist
        ? await savePlaylist(playlist.id, fields, source, setProgress, controller.signal)
        : await importPlaylist(source!, fields, setProgress, controller.signal);
      const count = result.playlist.channelCount;
      if (!playlist) toast(t('add.added', { count }), { tone: 'success' });
      else toast(source ? t('playlists.refreshed', { count }) : t('playlists.saved'), { tone: 'success' });
      if (result.unsupported) toast(t('add.unsupported', { count: result.unsupported }), { tone: 'warning', duration: 7000 });
      if (!playlist) {
        setUrl('');
        setName('');
        setFile(null);
        setGuideUrl('');
        setUserAgent('');
      }
      onSaved?.(result.playlist);
    } catch (err) {
      if (!controller.signal.aborted) setError(describeImportError(err, t));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProgress(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !canSubmit) return;

    const guide = guideUrl.trim();
    if (guide && !isHttpUrl(guide)) {
      setAdvanced(true);
      setError({ message: t('error.invalidGuideUrl') });
      return;
    }
    const fields: PlaylistFields = { name, epgOverride: guide, userAgent };

    if (mode === 'file') {
      void run(file ? { kind: 'file', file } : undefined, fields);
      return;
    }
    const link = url.trim();
    if (!isHttpUrl(link)) {
      setError({ message: t('error.invalidUrl') });
      return;
    }
    const other = findPlaylistByUrl(link, playlist?.id);
    if (other) {
      setError({ message: t('add.duplicate', { name: other.name }) });
      return;
    }
    // An unchanged link keeps the stored channels; Refresh downloads them again.
    void run(link === playlist?.url ? undefined : { kind: 'url', url: link }, fields);
  }

  function pickFile(picked: File | undefined) {
    if (!picked) return;
    setFile(picked);
    setError(null);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!busy) pickFile(event.dataTransfer.files[0]);
  }

  return (
    <form
      className="playlist-form"
      onSubmit={onSubmit}
      noValidate
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        setMode('file');
        setDragging(true);
      }}
    >
      <Segmented
        label={t('add.source')}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setError(null);
        }}
        options={[
          { value: 'url', label: t('add.url'), icon: Link },
          { value: 'file', label: t('add.file'), icon: FileUp },
        ]}
      />

      {mode === 'url' ? (
        <label className="field">
          <span className="field__label">{t('add.urlLabel')}</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t('add.urlPlaceholder')}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoFocus={autoFocus}
            disabled={busy}
          />
          {editing && <span className="field__hint">{t('add.urlEditHint')}</span>}
        </label>
      ) : (
        <label
          className="dropzone"
          data-dragging={dragging || undefined}
          data-filled={file || currentFile ? true : undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            type="file"
            className="sr-only"
            accept=".m3u,.m3u8,audio/x-mpegurl,audio/mpegurl,application/x-mpegurl,application/vnd.apple.mpegurl,text/plain"
            onChange={(event) => pickFile(event.target.files?.[0])}
            disabled={busy}
          />
          <Upload aria-hidden="true" />
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{formatBytes(file.size)}</span>
            </>
          ) : currentFile ? (
            <>
              <strong>{currentFile}</strong>
              <span>{t('add.fileReplace')}</span>
            </>
          ) : (
            <>
              <strong>{t('add.drop')}</strong>
              <span>{t('add.browse')}</span>
            </>
          )}
        </label>
      )}

      <label className="field">
        <span className="field__label">
          {t('add.nameLabel')} {!editing && <small>{t('add.optional')}</small>}
        </span>
        <input
          className="input"
          value={name}
          maxLength={60}
          placeholder={editing ? undefined : t('add.namePlaceholder')}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
      </label>

      <details className="disclosure" open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
        <summary>
          <ChevronRight className="disclosure__chevron" aria-hidden="true" />
          <span className="disclosure__title">{t('add.advanced')}</span>
          <span className="disclosure__summary">{t('add.advancedHint')}</span>
        </summary>
        <div className="disclosure__body">
          <label className="field">
            <span className="field__label">
              {t('guide.url')} <small>{t('add.optional')}</small>
            </span>
            <input
              className="input"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={playlist?.epgUrl ?? t('add.guidePlaceholder')}
              value={guideUrl}
              onChange={(event) => setGuideUrl(event.target.value)}
              disabled={busy}
            />
            <span className="field__hint">{t('guide.urlHint')}</span>
          </label>
          <label className="field">
            <span className="field__label">
              {t('add.userAgent')} <small>{t('add.optional')}</small>
            </span>
            <input
              className="input"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="VLC/3.0.20 LibVLC/3.0.20"
              value={userAgent}
              onChange={(event) => setUserAgent(event.target.value)}
              disabled={busy}
            />
            <span className="field__hint">{t('add.userAgentHint')}</span>
          </label>
        </div>
      </details>

      {error && (
        <div className="playlist-form__error" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <p>{error.message}</p>
            {error.hint && <p className="playlist-form__hint">{error.hint}</p>}
          </div>
        </div>
      )}

      <button type="submit" className="btn btn--primary btn--block" disabled={busy || !canSubmit}>
        {progress ? (
          <>
            <span className="spinner spinner--small" aria-hidden="true" />
            {progressLabel(progress, t)}
          </>
        ) : editing ? (
          t('common.save')
        ) : (
          t('add.submit')
        )}
      </button>

      {showDemo && !editing && !demoAdded && (
        <button
          type="button"
          className="playlist-form__demo"
          onClick={() => void run({ kind: 'url', url: demoUrl() }, { name: t('onboarding.demoName') })}
          disabled={busy}
        >
          {hasPlaylists ? t('add.demo') : t('onboarding.demo')}
        </button>
      )}
    </form>
  );
}

function progressLabel(progress: ImportProgress, t: Translate): string {
  if (progress.stage === 'parse') return t('add.stageParse');
  if (progress.stage === 'save') return t('add.stageSave');
  return progress.loaded ? `${t('add.stageDownload')} ${formatBytes(progress.loaded)}` : t('add.stageDownload');
}

function describeImportError(error: unknown, t: Translate): { message: string; hint?: string } {
  if (error instanceof FetchTextError) {
    switch (error.reason) {
      case 'mixed-content':
        return { message: t('error.mixedContent'), hint: t('error.proxyHint') };
      case 'http':
        if (error.status === 401 || error.status === 403) return { message: t('error.httpAuth', { status: error.status }) };
        if (error.status === 404) return { message: t('error.httpNotFound') };
        return { message: t('error.http', { status: error.status ?? '?' }) };
      case 'network':
        return error.viaProxy ? { message: t('error.networkViaProxy') } : { message: t('error.network'), hint: t('error.networkHint') };
    }
  }
  if (error instanceof M3UError) {
    const key = ({ html: 'error.html', 'not-m3u': 'error.notM3u', empty: 'error.empty' } as const)[error.code];
    return { message: t(key) };
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return { message: t('error.storage') };
  return { message: t('error.unknown') };
}
