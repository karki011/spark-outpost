import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  contrastChoices,
  DEFAULT_APPEARANCE,
  formatAppearance,
  modes,
  parseAppearance,
  resolveIslandSkin,
  resolveSkin,
  tints,
  type Appearance,
  type SystemLook,
} from './theme.ts';

const LIGHT_MAC: SystemLook = { dark: false, moreContrast: false };
const DARK_MAC: SystemLook = { dark: true, moreContrast: false };
const LOOKS: SystemLook[] = [
  LIGHT_MAC,
  DARK_MAC,
  { dark: false, moreContrast: true },
  { dark: true, moreContrast: true },
];
const LEGACY_THEMES = [
  'system',
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'aurora',
  'iris',
  'contrast',
  'light',
  'dark',
];

const everyAppearance: Appearance[] = modes.flatMap((mode) =>
  tints.flatMap((tint) =>
    contrastChoices.map((contrast) => ({ mode: mode.id, tint: tint.id, contrast: contrast.id })),
  ),
);

interface BootAppearance {
  resolve(stored: string | null, look: SystemLook, island: boolean): string;
}

function bootScript(): BootAppearance {
  const source = readFileSync(path.join(import.meta.dirname, '../../public/appearance.js'), 'utf8');
  const context: { sparkAppearance?: BootAppearance } = {};
  runInNewContext(source, context);
  return context.sparkAppearance!;
}

describe('appearance migration', () => {
  it('follows the system with the Graphite tint when nothing was chosen', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('system')).toEqual(DEFAULT_APPEARANCE);
    expect(DEFAULT_APPEARANCE).toEqual({ mode: 'auto', tint: 'graphite', contrast: 'system' });
  });

  it('keeps a picked theme exactly as it looked, as its tint plus a fixed mode', () => {
    expect(parseAppearance('graphite')).toEqual({ ...DEFAULT_APPEARANCE, mode: 'dark' });
    expect(parseAppearance('apricot')).toEqual({
      ...DEFAULT_APPEARANCE,
      mode: 'light',
      tint: 'apricot',
    });
    expect(parseAppearance('plum')).toEqual({
      ...DEFAULT_APPEARANCE,
      mode: 'dark',
      tint: 'apricot',
    });
    expect(parseAppearance('void')).toEqual({ ...DEFAULT_APPEARANCE, mode: 'dark', tint: 'fjord' });
    expect(parseAppearance('sage')).toEqual({ ...DEFAULT_APPEARANCE, mode: 'light', tint: 'sage' });
    expect(parseAppearance('contrast')).toEqual({
      ...DEFAULT_APPEARANCE,
      mode: 'light',
      contrast: 'always',
    });
    for (const theme of LEGACY_THEMES.filter((id) => id !== 'system')) {
      for (const look of [LIGHT_MAC, DARK_MAC]) {
        expect(resolveSkin(parseAppearance(theme), look)).toBe(
          theme === 'dark' ? 'graphite' : theme,
        );
      }
    }
  });

  it('falls back to the default for anything it does not know', () => {
    for (const stored of [
      'nope',
      'auto.nope.system',
      'auto.graphite',
      'dim.graphite.system',
      'a.b.c.d',
    ]) {
      expect(parseAppearance(stored)).toEqual(DEFAULT_APPEARANCE);
    }
  });

  it('round-trips every choice through storage', () => {
    for (const appearance of everyAppearance) {
      expect(parseAppearance(formatAppearance(appearance))).toEqual(appearance);
    }
  });
});

describe('the skin a choice shows', () => {
  it('follows the system in Automatic and pins the side in Light or Dark', () => {
    const lagoon: Appearance = { ...DEFAULT_APPEARANCE, tint: 'lagoon' };
    expect(resolveSkin(lagoon, LIGHT_MAC)).toBe('lagoon');
    expect(resolveSkin(lagoon, DARK_MAC)).toBe('moss');
    expect(resolveSkin({ ...lagoon, mode: 'light' }, DARK_MAC)).toBe('lagoon');
    expect(resolveSkin({ ...lagoon, mode: 'dark' }, LIGHT_MAC)).toBe('moss');
  });

  it('gives every tint a light side and a dark side', () => {
    const sides = tints.flatMap((tint) => [tint.light, tint.dark]);
    expect(new Set(sides).size).toBe(sides.length);
  });

  it('uses the high-contrast set on the matching side when Increase contrast is on', () => {
    const iris: Appearance = { ...DEFAULT_APPEARANCE, tint: 'iris' };
    expect(resolveSkin(iris, { dark: false, moreContrast: true })).toBe('contrast');
    expect(resolveSkin(iris, { dark: true, moreContrast: true })).toBe('contrast-dark');
    expect(resolveSkin({ ...iris, contrast: 'always' }, DARK_MAC)).toBe('contrast-dark');
  });

  it('keeps the island on the tint dark side whatever the mode', () => {
    for (const appearance of everyAppearance) {
      for (const look of LOOKS) {
        const skin = resolveIslandSkin(appearance, look);
        const contrast = appearance.contrast === 'always' || look.moreContrast;
        const dark = tints.find((tint) => tint.id === appearance.tint)!.dark;
        expect(skin).toBe(contrast ? 'contrast-dark' : dark);
      }
    }
  });
});

describe('the boot script', () => {
  it('picks the same skin as the app before React mounts', () => {
    const boot = bootScript();
    const stored = [
      null,
      'garbage',
      ...LEGACY_THEMES,
      ...everyAppearance.map((appearance) => formatAppearance(appearance)),
    ];
    for (const value of stored) {
      const appearance = parseAppearance(value);
      for (const look of LOOKS) {
        expect(boot.resolve(value, look, false)).toBe(resolveSkin(appearance, look));
        expect(boot.resolve(value, look, true)).toBe(resolveIslandSkin(appearance, look));
      }
    }
  });
});
