import { Download, Globe, Keyboard, MonitorPlay, Play, Shield, Trash2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useT, type MessageKey } from '../../i18n';
import { LANGUAGES } from '../../i18n/language';
import { isIos, isStandalone, useInstallPrompt } from '../../lib/install';
import type { ProxyMode } from '../../lib/proxy';
import { isHttpUrl } from '../../lib/text';
import { useLibrary } from '../../store/library';
import { resetApp } from '../../store/playlists';
import { useSession } from '../../store/session';
import { toast } from '../../store/toasts';
import { Segmented, Switch } from '../common';

const SHORTCUTS: [string[], MessageKey][] = [
  [['↑', '↓'], 'shortcut.zap'],
  [['Enter', '→'], 'shortcut.menu'],
  [['Space'], 'shortcut.playPause'],
  [['M'], 'shortcut.mute'],
  [['F'], 'shortcut.fullscreen'],
  [['L'], 'shortcut.recall'],
  [['I'], 'shortcut.info'],
  [['0–9'], 'shortcut.number'],
  [['Esc'], 'shortcut.close'],
];

export function SettingsPanel() {
  const t = useT();
  const settings = useLibrary((s) => s.settings);
  const updateSettings = useLibrary((s) => s.updateSettings);
  const builtInProxy = useSession((s) => s.builtInProxy);
  const install = useInstallPrompt();
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl);
  const [userAgent, setUserAgent] = useState(settings.userAgent);

  function saveProxyUrl() {
    const value = proxyUrl.trim();
    if (value && !isHttpUrl(value) && !value.startsWith('/')) {
      toast(t('error.invalidUrl'), { tone: 'error' });
      return;
    }
    updateSettings({ proxyUrl: value });
  }

  function reset() {
    if (window.confirm(t('settings.resetConfirm'))) void resetApp();
  }

  const proxyModes: { value: ProxyMode; label: string }[] = [
    { value: 'auto', label: t('settings.proxyAuto') },
    { value: 'always', label: t('settings.proxyAlways') },
    { value: 'off', label: t('settings.proxyOff') },
  ];

  return (
    <div className="panel panel--scroll settings">
      <section className="settings__section">
        <h3>
          <Globe aria-hidden="true" />
          {t('settings.language')}
        </h3>
        <Segmented
          label={t('settings.language')}
          value={settings.language}
          onChange={(language) => updateSettings({ language })}
          options={LANGUAGES.map(({ id, label }) => ({ value: id, label }))}
        />
      </section>

      <section className="settings__section">
        <h3>
          <Play aria-hidden="true" />
          {t('settings.playback')}
        </h3>
        <Switch
          label={t('settings.autoplayLast')}
          checked={settings.autoplayLast}
          onChange={(autoplayLast) => updateSettings({ autoplayLast })}
        />
      </section>

      <section className="settings__section">
        <h3>
          <Shield aria-hidden="true" />
          {t('settings.proxy')}
        </h3>
        <p className="settings__info">{t('settings.proxyInfo')}</p>
        <p className="settings__status">
          {t('settings.proxyBuiltIn')}
          <span className="status-dot" data-ok={builtInProxy || undefined}>
            {builtInProxy ? t('settings.proxyReady') : t('settings.proxyMissing')}
          </span>
        </p>
        <div className="field">
          <span className="field__label">{t('settings.proxyMode')}</span>
          <Segmented
            label={t('settings.proxyMode')}
            value={settings.proxyMode}
            onChange={(proxyMode) => updateSettings({ proxyMode })}
            options={proxyModes}
          />
        </div>
        <label className="field">
          <span className="field__label">{t('settings.proxyUrl')}</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            spellCheck={false}
            placeholder="http://192.168.1.10:8080/proxy"
            value={proxyUrl}
            onChange={(event) => setProxyUrl(event.target.value)}
            onBlur={saveProxyUrl}
          />
          <span className="field__hint">{t('settings.proxyUrlHint')}</span>
        </label>
        <label className="field">
          <span className="field__label">{t('settings.userAgent')}</span>
          <input
            className="input"
            spellCheck={false}
            placeholder="VLC/3.0.20 LibVLC/3.0.20"
            value={userAgent}
            onChange={(event) => setUserAgent(event.target.value)}
            onBlur={() => updateSettings({ userAgent: userAgent.trim() })}
          />
          <span className="field__hint">{t('settings.userAgentHint')}</span>
        </label>
      </section>

      <section className="settings__section">
        <h3>
          <Keyboard aria-hidden="true" />
          {t('settings.shortcuts')}
        </h3>
        <dl className="shortcuts">
          {SHORTCUTS.map(([keys, label]) => (
            <Fragment key={label}>
              <dt>
                {keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{t(label)}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section className="settings__section">
        <h3>
          <MonitorPlay aria-hidden="true" />
          {t('settings.app')}
        </h3>
        {isStandalone() ? (
          <p className="settings__info">{t('settings.installed')}</p>
        ) : install ? (
          <>
            <p className="settings__info">{t('settings.installHint', { app: __APP_NAME__ })}</p>
            <button type="button" className="btn btn--primary" onClick={() => void install()}>
              <Download aria-hidden="true" />
              {t('settings.install')}
            </button>
          </>
        ) : isIos() ? (
          <p className="settings__info">{t('settings.installIos')}</p>
        ) : null}
        <button type="button" className="btn btn--danger" onClick={reset}>
          <Trash2 aria-hidden="true" />
          {t('settings.reset')}
        </button>
        <p className="settings__version">{t('settings.version', { version: __APP_VERSION__ })}</p>
      </section>
    </div>
  );
}
