import { useCallback } from 'react';
import { useLibrary } from '../store/library';
import { en, type Message } from './en';
import type { Language } from './language';
import { tr } from './tr';

export type MessageKey = keyof typeof tr;
export type MessageVars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: MessageVars) => string;

const dictionaries: Record<Language, Record<MessageKey, Message>> = { tr, en };

export function translate(language: Language, key: MessageKey, vars?: MessageVars): string {
  const message = dictionaries[language][key];
  const count = Number(vars?.count ?? 0);
  const template =
    typeof message === 'string' ? message : new Intl.PluralRules(language).select(count) === 'one' ? message.one : message.other;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return name === 'count' && typeof value === 'number' ? value.toLocaleString(language) : String(value);
  });
}

export function useT(): Translate {
  const language = useLibrary((state) => state.settings.language);
  return useCallback((key, vars) => translate(language, key, vars), [language]);
}

/** Translation for code outside components (actions, toasts). */
export function t(key: MessageKey, vars?: MessageVars): string {
  return translate(useLibrary.getState().settings.language, key, vars);
}

export function useLanguage(): Language {
  return useLibrary((state) => state.settings.language);
}

/** "21:30" (or "9:30 PM" in English). */
export function formatClockTime(timestamp: number, language: Language): string {
  return new Date(timestamp).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatRelativeTime(timestamp: number, language: Language): string {
  const seconds = (timestamp - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}
