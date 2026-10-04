import type { ReactNode } from 'react';
import type { OutlineMark } from './outline-model.ts';

function Glyph({ children, size = 12 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

const MARKS: Record<OutlineMark, ReactNode> = {
  plan: <path d="M8 6h12M8 12h12M8 18h8M4 6h.01M4 12h.01M4 18h.01" />,
  approval: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  files: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  pr: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5v7M18 15.5V10a4 4 0 0 0-4-4h-2" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5h.01" />
    </>
  ),
};

export function MarkIcon({ mark }: { mark: OutlineMark }) {
  return <Glyph>{MARKS[mark]}</Glyph>;
}

export function UsageIcon() {
  return (
    <Glyph size={14}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 9 9h-9z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function ChangesIcon() {
  return (
    <Glyph size={14}>
      <path d="M12 5v8M8 9h8M8 18h8" />
    </Glyph>
  );
}

export function PullRequestIcon() {
  return <Glyph size={14}>{MARKS.pr}</Glyph>;
}

export function RailToggleIcon({ open }: { open: boolean }) {
  return (
    <Glyph size={14}>
      <path d={open ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
    </Glyph>
  );
}
