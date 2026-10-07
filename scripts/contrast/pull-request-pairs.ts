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

const WATCH_INKS = {
  quiet: 'var(--muted)',
  live: 'var(--accent-text)',
  warn: 'var(--warn)',
  label: 'var(--text)',
  problem: 'var(--danger)',
};

const WATCH_SURFACES = { row: ROWS.row, panel: ROWS.panel };

const watching: Pair[] = Object.entries(WATCH_SURFACES).flatMap(([surface, bg]) =>
  Object.entries(WATCH_INKS).flatMap(([ink, fg]) =>
    (['text', 'ui'] as const).map((kind) => ({
      id: `pull-request.watch-${ink}-${kind}-on-${surface}`,
      group: 'Pull request card',
      label: `Watching indicator, ${ink} ${kind === 'ui' ? 'icon' : 'text'} on the ${surface} surface`,
      fg,
      bg: [bg],
      kind,
    })),
  ),
);

export const PULL_REQUESTS: Pair[] = [...rowText, ...focus, ...watching];
