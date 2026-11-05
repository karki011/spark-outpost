import type { Pair } from './pair-types.ts';

const TILE_PROVIDERS = ['claude', 'codex', 'zai'] as const;
const tile = (provider: string) => [`color-mix(in srgb, var(--c-${provider}) 16%, var(--panel))`];
const FLAG = ['color-mix(in srgb, var(--warn) 10%, var(--panel))'];

const pair = (id: string, label: string, fg: string, bg: string[], kind: Pair['kind']): Pair => ({
  id: `analytics.${id}`,
  group: 'Analytics',
  label,
  fg,
  bg,
  kind,
});

export const ANALYTICS: Pair[] = [
  pair('heat-dot', 'heatmap and ring fill on its track', 'var(--accent)', ['var(--raise)'], 'ui'),
  pair('trend-line', 'trend line and bars on the card', 'var(--accent)', ['var(--panel)'], 'ui'),
  pair(
    'gate-line',
    'gate and zero lines on the card',
    'var(--line-strong)',
    ['var(--panel)'],
    'ui',
  ),
  ...(['success', 'warn', 'danger', 'muted'] as const).map((token) =>
    pair(
      `mark-${token}`,
      `${token} outcome mark on the card`,
      `var(--${token})`,
      ['var(--panel)'],
      'ui',
    ),
  ),
  ...TILE_PROVIDERS.flatMap((provider) => [
    pair(
      `tile-text-${provider}`,
      `model name on a ${provider} treemap tile`,
      'var(--text)',
      tile(provider),
      'text',
    ),
    pair(
      `tile-cost-${provider}`,
      `cost (muted) on a ${provider} treemap tile`,
      'var(--muted)',
      tile(provider),
      'text',
    ),
    pair(
      `tile-edge-${provider}`,
      `${provider} edge strip on its tile`,
      `var(--c-${provider})`,
      tile(provider),
      'ui',
    ),
  ]),
  pair('flag', 'small-sample flag text on its tint', 'var(--warn)', FLAG, 'text'),
  pair(
    'winner',
    'winner chip text on the accent tint',
    'var(--accent-text)',
    ['var(--panel)', 'var(--accent-soft)'],
    'text',
  ),
  pair('focus-mark', 'focus ring around a chart mark', 'var(--accent)', ['var(--panel)'], 'focus'),
  pair(
    'cal-range-text',
    'selected day text on the accent fill',
    'var(--accent-ink)',
    ['var(--accent)'],
    'text',
  ),
  pair(
    'cal-range-middle-text',
    'in-range day text on the soft accent band',
    'var(--accent-text)',
    ['var(--panel)', 'var(--accent-soft)'],
    'text',
  ),
  pair(
    'cal-today-ring',
    'today outline on the calendar grid',
    'var(--accent)',
    ['var(--panel)'],
    'ui',
  ),
  pair(
    'cal-preset-text',
    'preset button text on the popover',
    'var(--text)',
    ['var(--panel)'],
    'text',
  ),
  pair('updating-dot', 'updating dot on its pill', 'var(--accent)', ['var(--raise)'], 'ui'),
];
