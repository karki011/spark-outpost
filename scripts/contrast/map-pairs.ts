import type { Pair, PairKind } from './pair-types.ts';

const SKY = ['var(--map-sky-1)'];
const SKY_CENTRE = ['var(--map-sky-0)'];
const GLASS = ['var(--map-sky-1)', 'var(--map-glass)'];
const PILL = ['var(--map-sky-1)', 'var(--map-pill)'];
const CANVAS = ['var(--bg)'];
const CARD = ['var(--panel)'];
const CHANGED_CHIP = ['color-mix(in srgb, var(--map-warm) 14%, var(--panel))'];

function pair(id: string, label: string, fg: string, bg: string[], kind: PairKind): Pair {
  return { id: `map.${id}`, group: 'Project map', label, fg, bg, kind };
}

export const MAP: Pair[] = [
  pair('gold-on-sky', 'area name on the sky edge', 'var(--map-gold)', SKY, 'text'),
  pair('gold-on-centre', 'area name on the sky centre', 'var(--map-gold)', SKY_CENTRE, 'text'),
  pair('text-on-sky', 'file name in an area network', 'var(--text)', SKY, 'text'),
  pair('muted-on-sky', 'star name on the sky', 'var(--muted)', SKY, 'text'),
  pair('star-on-sky', 'star', 'var(--map-star)', SKY, 'ui'),
  pair('warm-on-sky', 'changed file ring', 'var(--map-warm)', SKY, 'ui'),
  pair('bridge-on-sky', 'link between projects', 'var(--map-bridge)', SKY, 'ui'),
  pair('event-on-sky', 'GraphQL link', 'var(--map-event)', SKY, 'ui'),
  pair('types-on-sky', 'shared package link', 'var(--map-types)', SKY, 'ui'),
  ...(['ui', 'api', 'data', 'test', 'config', 'other'] as const).map((kind) =>
    pair(`kind-${kind}-on-sky`, `${kind} file`, `var(--map-k-${kind})`, SKY, 'ui'),
  ),
  ...[1, 2, 3, 4].map((n) =>
    pair(`tint-${n}-on-sky`, `project ${n} name`, `var(--map-tint-${n})`, SKY, 'text'),
  ),
  pair('text-on-glass', 'panel text over the sky', 'var(--text)', GLASS, 'text'),
  pair('muted-on-glass', 'panel note over the sky', 'var(--muted)', GLASS, 'text'),
  pair('gold-on-glass', 'legend and area heading', 'var(--map-gold)', GLASS, 'text'),
  pair('text-on-pill', 'link label', 'var(--text)', PILL, 'text'),
  ...(['ui', 'api', 'data', 'test', 'config', 'other'] as const).map((kind) =>
    pair(
      `kind-${kind}-on-card`,
      `${kind} share in a tree card`,
      `var(--map-k-${kind})`,
      CARD,
      'ui',
    ),
  ),
  pair('gold-on-card', 'importance bar in a tree card', 'var(--map-gold)', CARD, 'ui'),
  pair('warm-on-canvas', 'changed ring around a tree card', 'var(--map-warm)', CANVAS, 'ui'),
  pair('warn-on-changed', 'changed count chip', 'var(--warn)', CHANGED_CHIP, 'text'),
  pair('edge-on-canvas', 'import line in the tree', 'var(--line-strong)', CANVAS, 'ui'),
  pair('bridge-on-canvas', 'link between projects in the tree', 'var(--map-bridge)', CANVAS, 'ui'),
];
