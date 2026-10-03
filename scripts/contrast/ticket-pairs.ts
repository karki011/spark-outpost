import type { Pair } from './pair-types.ts';

const ROWS = {
  row: 'var(--panel)',
  hovered: 'var(--raise)',
  selected: 'color-mix(in srgb, var(--accent) 11%, var(--panel))',
};

const TONES = {
  needs: 'var(--warn)',
  bad: 'var(--danger)',
  spark: 'var(--accent-text)',
  started: 'var(--text)',
  next: 'var(--muted)',
  review: 'var(--accent-text)',
  done: 'var(--success)',
};

const TINTED = new Set(['needs', 'bad', 'spark', 'started']);

const rowChips: Pair[] = Object.entries(TONES).flatMap(([tone, fg]) =>
  TINTED.has(tone)
    ? [
        {
          id: `tickets.chip-${tone}`,
          group: 'Tickets',
          label: `${tone} status chip`,
          fg,
          bg: [`color-mix(in srgb, ${fg} 11%, var(--panel))`],
          kind: 'text' as const,
        },
      ]
    : Object.entries(ROWS).map(([row, bg]) => ({
        id: `tickets.chip-${tone}-on-${row}`,
        group: 'Tickets',
        label: `${tone} status chip on a ${row} row`,
        fg,
        bg: [bg],
        kind: 'text' as const,
      })),
);

const summaryChips: Pair[] = [...Object.entries(TONES), ['all', 'var(--text)'] as const].map(
  ([tone, fg]) => ({
    id: `tickets.summary-${tone}-pressed`,
    group: 'Tickets',
    label: `${tone} summary chip, pressed`,
    fg,
    bg: [`color-mix(in srgb, ${fg} 13%, var(--panel))`],
    kind: 'text' as const,
  }),
);

export const TICKETS: Pair[] = [
  ...rowChips,
  ...summaryChips,
  {
    id: 'tickets.summary-count-pressed',
    group: 'Tickets',
    label: 'count in the pressed All chip',
    fg: 'var(--muted)',
    bg: ['color-mix(in srgb, var(--text) 13%, var(--panel))'],
    kind: 'text',
  },
];
