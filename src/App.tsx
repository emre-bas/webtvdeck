import { useEffect } from 'react';
import { Onboarding } from './components/Onboarding';
import { PlayerScreen } from './components/player/PlayerScreen';
import { Toaster } from './components/Toaster';
import { useLanguage } from './i18n';
import { useExitGuard } from './lib/exit-guard';
import { useServiceWorker } from './lib/pwa';
import { whenProxyKnown } from './store/proxy';
import { useLibrary } from './store/library';

export function App() {
  const activeId = useLibrary((s) => (s.playlists.some((p) => p.id === s.activePlaylistId) ? s.activePlaylistId : null));
  const language = useLanguage();

  useServiceWorker();
  useExitGuard();

  useEffect(() => {
    void whenProxyKnown();
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <>
      {activeId ? <PlayerScreen key={activeId} playlistId={activeId} /> : <Onboarding />}
      <Toaster />
    </>
  );
}
