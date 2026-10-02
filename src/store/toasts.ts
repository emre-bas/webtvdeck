import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

interface ToastOptions {
  tone?: ToastTone;
  action?: Toast['action'];
  /** Milliseconds; Infinity keeps the toast until it's dismissed. */
  duration?: number;
}

export const useToasts = create<{ toasts: Toast[] }>()(() => ({ toasts: [] }));

let nextId = 0;

export function toast(message: string, options: ToastOptions = {}): number {
  const id = ++nextId;
  const item: Toast = { id, message, tone: options.tone ?? 'info', action: options.action };
  useToasts.setState((state) => ({
    toasts: [...state.toasts.filter((existing) => existing.message !== message), item].slice(-3),
  }));
  const duration = options.duration ?? 3500;
  if (Number.isFinite(duration)) window.setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id: number): void {
  useToasts.setState((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
}
