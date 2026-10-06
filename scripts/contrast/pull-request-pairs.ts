import type { Pair } from './pair-types.ts';

const ROWS = {
  row: 'var(--raise)',
  merged: 'color-mix(in srgb, var(--accent) 11%, var(--panel))',
  panel: 'var(--panel)',
};

const INKS = {
  title: 'var(--text)',
  quiet: 'var(--muted)',
  open: 'var(--success)',
  merged: 'var(--accent-text)',
  closed: 'var(--danger)',
  'needs-you': 'var(--warn)',
};

const DETAIL_ONLY = { when: 'var(--faint)' };

const rowText: Pair[] = Object.entries(ROWS).flatMap(([row, bg]) =>
  Object.entries({ ...INKS, ...(row === 'panel' ? DETAIL_ONLY : {}) }).map(([ink, fg]) => ({
    id: `pull-request.${ink}-on-${row}`,
    group: 'Pull request card',
    label: `${ink} text on the ${row} surface of the pull request card`,
    fg,
    bg: [bg],
    kind: 'text' as const,
  })),
);

const focus: Pair[] = Object.entries(ROWS).map(([row, bg]) => ({
  id: `pull-request.focus-on-${row}`,
  group: 'Pull request card',
  label: `Focus ring on the ${row} surface of the pull request card`,
  fg: 'var(--accent-text)',
  bg: [bg],
  kind: 'focus' as const,
}));

export const PULL_REQUESTS: Pair[] = [...rowText, ...focus];
