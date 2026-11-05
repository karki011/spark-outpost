import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function WatchIcon({ on }: { on: boolean }) {
  return (
    <Icon>
      {on ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      )}
    </Icon>
  );
}

export function ChatterIcon({ muted }: { muted: boolean }) {
  return (
    <Icon>
      <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      {muted && <path d="m3 3 18 18" />}
    </Icon>
  );
}

export function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" />
    </svg>
  );
}

export function StageIcon() {
  return (
    <Icon>
      <circle cx="12" cy="15" r="3.2" />
      <circle cx="5.5" cy="7" r="2" />
      <circle cx="18.5" cy="7" r="2" />
      <path d="M7 8.6 9.8 12.6M17 8.6l-2.8 4" />
    </Icon>
  );
}

export function ListIcon() {
  return (
    <Icon>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="2.6" />
    </Icon>
  );
}

export function TvIcon() {
  return (
    <Icon>
      <rect x="3" y="7" width="18" height="13" rx="3" />
      <path d="m8 3 4 4 4-4" />
    </Icon>
  );
}
