import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { toast } from '../store/toasts';
import { useBackLayer } from './back-stack';

/** How long the warning stays up; pressing Back again meanwhile leaves the app. */
const WARNING_MS = 3000;

/**
 * Back with nothing open warns before leaving the app, like TV and Android apps do: the first
 * press shows "press Back again to exit", a second one while that's on screen leaves. It's the
 * bottom layer (level 0) of the back stack, so Escape never triggers it.
 */
export function useExitGuard(): void {
  const [warning, setWarning] = useState(false);

  // While the warning is up the guard is gone, so the next Back leaves the app.
  useEffect(() => {
    if (!warning) return;
    const timer = window.setTimeout(() => setWarning(false), WARNING_MS);
    return () => window.clearTimeout(timer);
  }, [warning]);

  useBackLayer(
    !warning,
    () => {
      setWarning(true);
      toast(t('toast.exitAgain'), { duration: WARNING_MS });
    },
    0,
  );
}
