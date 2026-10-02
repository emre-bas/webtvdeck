import { useId } from 'react';

/** A screen with a play mark at the front of a deck of screens. `tile` draws the dark app-icon background. */
export function Logo({ size = 40, tile = false }: { size?: number; tile?: boolean }) {
  const gradient = `${useId()}-screen`;
  const stroke = `url(#${gradient})`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="10" y1="11" x2="54" y2="53">
          <stop offset="0" stopColor="#74f2d4" />
          <stop offset="1" stopColor="#2fb4e6" />
        </linearGradient>
      </defs>
      {tile && <rect width="64" height="64" rx="15" fill="#0b0e13" />}
      <path d="M20 17a6 6 0 0 1 6-6h12a6 6 0 0 1 6 6" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" opacity="0.25" />
      <path d="M15 23a6 6 0 0 1 6-6h22a6 6 0 0 1 6 6" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      <rect x="10" y="23" width="44" height="30" rx="7" fill="none" stroke={stroke} strokeWidth="4.5" />
      <path d="M29 32 39 38 29 44Z" fill="#eef1f5" stroke="#eef1f5" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}
