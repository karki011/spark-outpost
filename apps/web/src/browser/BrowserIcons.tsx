import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
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

export function ZoomIcon() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4M11 8v6M8 11h6" />
    </Icon>
  );
}

export function GlobeIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
    </Icon>
  );
}

export function DevtoolsIcon() {
  return (
    <Icon>
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
    </Icon>
  );
}

export function NavBackIcon() {
  return (
    <Icon>
      <path d="M19 12H5m6-6-6 6 6 6" />
    </Icon>
  );
}

export function NavForwardIcon() {
  return (
    <Icon>
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </Icon>
  );
}

export function ReloadIcon() {
  return (
    <Icon>
      <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
    </Icon>
  );
}

export function StopIcon() {
  return (
    <Icon>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

export function PickElementIcon() {
  return (
    <Icon>
      <path d="M4 4h12v6M4 4v12h6" />
      <path d="m13 13 7 3-3 1-1 3z" />
    </Icon>
  );
}

export function PickRegionIcon() {
  return (
    <Icon>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    </Icon>
  );
}

export function PageWidthIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 12h10M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5" />
    </Icon>
  );
}

export function SplitViewIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M12 5v14" />
    </Icon>
  );
}

export function ShowingIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </Icon>
  );
}
