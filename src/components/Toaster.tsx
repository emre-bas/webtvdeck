import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useT } from '../i18n';
import { dismissToast, useToasts, type ToastTone } from '../store/toasts';
import './Toaster.css';

const ICONS: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleAlert,
};

export function Toaster() {
  const t = useT();
  const toasts = useToasts((state) => state.toasts);

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <div key={item.id} className="toast" data-tone={item.tone}>
            <Icon className="toast__icon" aria-hidden="true" />
            <span className="toast__message">{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  item.action?.run();
                  dismissToast(item.id);
                }}
              >
                {item.action.label}
              </button>
            )}
            <button type="button" className="toast__close" aria-label={t('common.close')} onClick={() => dismissToast(item.id)}>
              <X />
            </button>
          </div>
        );
      })}
    </div>
  );
}
