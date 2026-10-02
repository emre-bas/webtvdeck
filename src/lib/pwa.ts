import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../i18n';
import { toast } from '../store/toasts';

/** Registers the service worker and offers a reload when a new version is waiting. */
export function useServiceWorker(): void {
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!needRefresh) return;
    // No auto-reload: that would interrupt whatever is playing.
    toast(t('toast.updateReady'), {
      duration: Infinity,
      action: { label: t('toast.reload'), run: () => void updateServiceWorker(true) },
    });
  }, [needRefresh, updateServiceWorker]);

  useEffect(() => {
    if (offlineReady) toast(t('toast.offlineReady', { app: __APP_NAME__ }), { tone: 'success' });
  }, [offlineReady]);
}
