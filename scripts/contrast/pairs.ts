import { AGENT_TV, DIFF, OFFLINE } from './content-pairs.ts';
import { ACCENT, CHIPS, FORMS, STATUS } from './interface-pairs.ts';
import { surfaceText, type HuePair, type Pair, type PairKind } from './pair-types.ts';

export type { HuePair, Pair, PairKind };

export const THRESHOLDS: Record<PairKind, number> = {
  text: 4.5,
  large: 3,
  ui: 3,
  focus: 3,
  disabled: 0,
  decorative: 0,
};

export const ALLOWLIST: Record<string, string> = {
  'disabled.button-label':
    'WCAG 1.4.3 exempts inactive components; disabled buttons also carry the disabled attribute and a not-allowed cursor.',
  'disabled.button-ghost':
    'WCAG 1.4.3 exempts inactive components; disabled buttons also carry the disabled attribute and a not-allowed cursor.',
  'offline.zz':
    'Decorative sleeping "z" glyphs on the offline mascot (aria-hidden); WCAG 1.4.3 exempts pure decoration.',
};

export const PAIRS: Pair[] = [
  ...surfaceText(),
  ...ACCENT,
  ...STATUS,
  ...FORMS,
  ...CHIPS,
  ...DIFF,
  ...OFFLINE,
  ...AGENT_TV,
];

export const HUE_PAIRS: HuePair[] = [
  {
    id: 'diff.add-vs-remove',
    label: 'added vs removed hue',
    first: 'var(--success)',
    second: 'var(--danger)',
    minDegrees: 60,
  },
];
