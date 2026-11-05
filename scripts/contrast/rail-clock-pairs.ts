import type { Pair } from './pair-types.ts';

const GROUP = 'Rail clock';
const INKS = { digits: 'var(--text)', period: 'var(--muted)' };
const BACKS = { rail: ['var(--rail)'], hover: ['var(--rail)', 'var(--raise)'] };

export const RAIL_CLOCK: Pair[] = Object.entries(INKS).flatMap(([ink, fg]) =>
  Object.entries(BACKS).map(([back, bg]) => ({
    id: `rail-clock.${ink}-on-${back}`,
    group: GROUP,
    label: `${ink} on ${back === 'hover' ? 'hovered clock' : 'rail'}`,
    fg,
    bg,
    kind: 'text' as const,
  })),
);
