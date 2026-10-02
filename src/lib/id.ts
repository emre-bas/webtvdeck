export function createId(): string {
  // randomUUID only exists in secure contexts; opening the app over plain HTTP on the LAN
  // (e.g. from a TV) still provides getRandomValues.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
