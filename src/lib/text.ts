/**
 * Search key: lower case without diacritics, with the Turkish dotless ı folded to i, so
 * "İZMİR", "izmir" and "Izmir" all match each other.
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i');
}

/** Returns the items whose search key contains every whitespace-separated term of `query`. */
export function filterByQuery<T>(items: readonly T[], keys: readonly string[], query: string): T[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return items.slice();
  const result: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const key = keys[i] ?? '';
    if (terms.every((term) => key.includes(term))) result.push(items[i]!);
  }
  return result;
}

/** "TR: TRT 1 HD" → "T1". Leading country prefixes common in IPTV lists are skipped. */
export function initials(name: string): string {
  const cleaned = name.replace(/^\s*[A-Z]{2,3}\s*[:|]\s*/, '');
  const words = cleaned.split(/[\s\-_.|:]+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word.replace(/[^\p{L}\p{N}]/gu, '')][0] ?? '');
  return letters.join('').toLocaleUpperCase() || '?';
}

/** Stable hue for a name, used to tint logo placeholders. */
export function hueOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
