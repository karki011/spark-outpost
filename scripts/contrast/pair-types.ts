export type PairKind = 'text' | 'large' | 'ui' | 'focus' | 'disabled' | 'decorative';

export type Pair = {
  id: string;
  group: string;
  label: string;
  fg: string;
  bg: string[];
  kind: PairKind;
  fgAlpha?: number;
};

export type HuePair = {
  id: string;
  label: string;
  first: string;
  second: string;
  minDegrees: number;
};

export const SURFACES = {
  canvas: ['var(--bg)'],
  panel: ['var(--panel)'],
  raise: ['var(--raise)'],
  rail: ['var(--rail)'],
  code: ['var(--code)'],
  card: ['color-mix(in srgb, var(--raise) 70%, var(--panel))'],
  selected: ['var(--panel)', 'var(--accent-soft)'],
  approval: ['color-mix(in srgb, var(--warn) 9%, var(--raise))'],
} satisfies Record<string, string[]>;

export type Surface = keyof typeof SURFACES;

const INKS = { text: 'var(--text)', muted: 'var(--muted)', faint: 'var(--faint)' };

const ICON_ONLY = new Set(['faint-on-approval']);

export function surfaceText(): Pair[] {
  return Object.entries(SURFACES).flatMap(([surface, bg]: [string, string[]]) =>
    Object.entries(INKS).map(([ink, fg]) => {
      const iconOnly = ICON_ONLY.has(`${ink}-on-${surface}`);
      return {
        id: `surface.${ink}-on-${surface}`,
        group: 'Surface text',
        label: iconOnly ? `${ink} icon on ${surface}` : `${ink} on ${surface}`,
        fg,
        bg,
        kind: iconOnly ? ('ui' as const) : ('text' as const),
      };
    }),
  );
}

export function onEach(
  group: string,
  prefix: string,
  fg: string,
  surfaces: Surface[],
  kind: PairKind,
): Pair[] {
  return surfaces.map((surface) => ({
    id: `${prefix}-on-${surface}`,
    group,
    label: `${prefix.split('.').pop() ?? prefix} on ${surface}`,
    fg,
    bg: SURFACES[surface],
    kind,
  }));
}
