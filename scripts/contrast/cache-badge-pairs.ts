import type { HuePair, Pair } from './pair-types.ts';

const GROUP = 'Prompt cache badge';
const INKS = { warm: 'var(--cache-warm)', expiring: 'var(--cache-expiring)' };

export const CACHE_BADGE: Pair[] = Object.entries(INKS).flatMap(([ink, fg]) => [
  {
    id: `cache-badge.${ink}-on-panel`,
    group: GROUP,
    label: `${ink} status on the ring popover`,
    fg,
    bg: ['var(--panel)'],
    kind: 'text' as const,
  },
  {
    id: `cache-badge.${ink}-on-hovered-ring`,
    group: GROUP,
    label: `${ink} badge on the hovered ring`,
    fg,
    bg: ['var(--raise)'],
    kind: 'ui' as const,
  },
]);

export const CACHE_BADGE_HUES: HuePair[] = [
  {
    id: 'cache-badge.expiring-vs-warn',
    label: 'expiring cache vs the ring’s warn level',
    first: 'var(--cache-expiring)',
    second: 'var(--warn)',
    minDegrees: 60,
  },
  {
    id: 'cache-badge.warm-vs-warn',
    label: 'warm cache vs the ring’s warn level',
    first: 'var(--cache-warm)',
    second: 'var(--warn)',
    minDegrees: 60,
  },
];
