import type { ReactNode } from 'react';

const RING_RADIUS = 7;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function ProgressRing({ progress, label }: { progress: number; label: string }) {
  const percent = Math.round(progress * 100);
  return (
    <svg
      className="att-ring"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <circle className="att-ring-track" cx="9" cy="9" r={RING_RADIUS} />
      <circle
        className="att-ring-fill"
        cx="9"
        cy="9"
        r={RING_RADIUS}
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - Math.max(0.04, progress))}
      />
    </svg>
  );
}

function Stroke({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function FileIcon() {
  return (
    <Stroke>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Stroke>
  );
}

export function RetryIcon() {
  return (
    <Stroke>
      <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
      <path d="M20 3.5v5h-5" />
    </Stroke>
  );
}
