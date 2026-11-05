import type { Pair } from './pair-types.ts';

const ROWS = {
  row: 'var(--panel)',
  hovered: 'var(--raise)',
  selected: 'color-mix(in srgb, var(--accent) 11%, var(--panel))',
};

const TONES = {
  todo: 'var(--muted)',
  in_progress: 'var(--accent-text)',
  in_review: 'var(--warn)',
  blocked: 'var(--danger)',
  done: 'var(--success)',
};

const TINTED = new Set(['in_progress', 'in_review', 'blocked']);

const rowChips: Pair[] = Object.entries(TONES).flatMap(([tone, fg]) =>
  TINTED.has(tone)
    ? [
        {
          id: `tickets.chip-${tone}`,
          group: 'Tickets',
          label: `${tone} status badge`,
          fg,
          bg: [`color-mix(in srgb, ${fg} 11%, var(--panel))`],
          kind: 'text' as const,
        },
      ]
    : Object.entries(ROWS).map(([row, bg]) => ({
        id: `tickets.chip-${tone}-on-${row}`,
        group: 'Tickets',
        label: `${tone} status badge on a ${row} row`,
        fg,
        bg: [bg],
        kind: 'text' as const,
      })),
);

const viewCounts: Pair[] = Object.entries({ row: ROWS.row, hovered: ROWS.hovered }).map(
  ([state, bg]) => ({
    id: `tickets.view-attention-count-${state}`,
    group: 'Tickets',
    label: `Needs you count in the side column, ${state}`,
    fg: 'var(--warn)',
    bg: [bg],
    kind: 'text' as const,
  }),
);

export const TICKETS: Pair[] = [...rowChips, ...viewCounts];
