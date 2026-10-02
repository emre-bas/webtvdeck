import { Download, Maximize, PanelRightOpen } from 'lucide-react';
import { useT } from '../i18n';
import { LANGUAGES } from '../i18n/language';
import { useLibrary } from '../store/library';
import { Segmented } from './common';
import { Logo } from './Logo';
import { PlaylistForm } from './PlaylistForm';
import './Onboarding.css';

export function Onboarding() {
  const t = useT();
  const language = useLibrary((state) => state.settings.language);
  const updateSettings = useLibrary((state) => state.updateSettings);

  return (
    <main className="onboarding" data-nav-scope="panel" data-nav-modal>
      <div className="onboarding__backdrop" aria-hidden="true" />

      <div className="onboarding__language">
        <Segmented
          label={t('settings.language')}
          value={language}
          onChange={(value) => updateSettings({ language: value })}
          options={LANGUAGES.map(({ id }) => ({ value: id, label: id.toUpperCase() }))}
        />
      </div>

      <section className="onboarding__card" aria-labelledby="onboarding-title">
        <header className="onboarding__brand">
          <Logo size={52} tile />
          <div>
            <p className="onboarding__wordmark">{__APP_NAME__}</p>
            <p className="onboarding__tagline">{t('app.tagline')}</p>
          </div>
        </header>

        <div className="onboarding__intro">
          <h1 id="onboarding-title">{t('onboarding.title')}</h1>
          <p>{t('onboarding.lead')}</p>
        </div>

        <PlaylistForm autoFocus showDemo />
      </section>

      <ul className="onboarding__features">
        <li>
          <Maximize aria-hidden="true" />
          {t('onboarding.featureFullscreen')}
        </li>
        <li>
          <PanelRightOpen aria-hidden="true" />
          {t('onboarding.featureMenu')}
        </li>
        <li>
          <Download aria-hidden="true" />
          {t('onboarding.featureInstall')}
        </li>
      </ul>
    </main>
  );
}
