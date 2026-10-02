export type Language = 'tr' | 'en';

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'English' },
];

export function detectLanguage(): Language {
  return navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

/** Encoding to assume for playlists that aren't valid UTF-8. */
export function legacyEncoding(language: Language): string {
  return language === 'tr' ? 'windows-1254' : 'windows-1252';
}
