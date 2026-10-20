import type { Pair } from './pair-types.ts';

const GROUP = 'Calendar selection';
const BACKS = {
  'day block': ['var(--raise)', 'var(--accent-soft)'],
  'ended block': ['var(--panel)', 'var(--accent-soft)'],
  'month cell': ['var(--panel)', 'var(--accent-soft)'],
  'rail card': ['var(--raise)', 'var(--accent-soft)'],
};

export const CALENDAR_SELECTION: Pair[] = [
  ...Object.entries(BACKS).map(([back, bg]) => ({
    id: `calendar-selection.${back.replace(' ', '-')}`,
    group: GROUP,
    label: `selected event title and time on the ${back} tint`,
    fg: 'var(--accent-text)',
    bg,
    kind: 'text' as const,
  })),
  {
    id: 'calendar-selection.focus-ring',
    group: GROUP,
    label: 'keyboard focus ring around an event',
    fg: 'var(--accent)',
    bg: ['var(--panel)'],
    kind: 'focus' as const,
  },
];
