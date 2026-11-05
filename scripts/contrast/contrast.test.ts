import { describe, expect, it } from 'vitest';
import { contrast, parseHex, toHex } from './color.ts';
import { auditTokens } from './audit.ts';
import { parseBlocks, resolver, THEMES, themeTokens } from './theme.ts';

describe('colour maths', () => {
  it('matches the WCAG reference ratios', () => {
    expect(contrast(parseHex('#000'), parseHex('#fff'))).toBeCloseTo(21, 5);
    expect(contrast(parseHex('#767676'), parseHex('#fff'))).toBeCloseTo(4.54, 2);
  });

  it('resolves nested tokens, alpha and srgb colour-mix like the browser', () => {
    const tokens = new Map([
      ['--accent', '#ff0000'],
      ['--soft', 'rgba(255, 0, 0, 0.5)'],
      ['--mix', 'color-mix(in srgb, var(--accent) 50%, #0000ff)'],
      ['--fade', 'color-mix(in srgb, var(--accent) 25%, transparent)'],
    ]);
    const resolve = resolver(tokens);
    expect(toHex(resolve('var(--mix)'))).toBe('#800080');
    expect(resolve('var(--soft)').a).toBeCloseTo(0.5);
    expect(resolve('var(--fade)')).toMatchObject({ r: 1, a: 0.25 });
    expect(toHex(resolve('oklch(0.628 0.2577 29.23)'))).toBe('#ff0000');
  });
});

describe('theme parsing', () => {
  it('reads media-scoped and skin-scoped blocks', () => {
    const blocks = parseBlocks(`:root { --a: #fff; } @media (x) { :root { --a: #000; } }`);
    expect(blocks.map((b) => [b.selector, b.media, b.declarations.get('--a')])).toEqual([
      [':root', undefined, '#fff'],
      [':root', '@media (x)', '#000'],
    ]);
  });

  it('gives every theme its own accent', () => {
    const accents = THEMES.map((theme) => themeTokens(theme).get('--accent'));
    expect(new Set(accents).size).toBeGreaterThan(5);
  });
});

describe('audit', () => {
  it('flags a failing pair and records allowlisted ones as exempt', () => {
    const tokens = themeTokens('light');
    tokens.set('--faint', '#dddddd');
    const { pairs } = auditTokens(tokens);
    expect(pairs.find((p) => p.id === 'surface.faint-on-panel')?.status).toBe('fail');
    expect(pairs.find((p) => p.id === 'disabled.button-label')?.status).toBe('exempt');
  });

  it('passes every shipped theme', () => {
    for (const theme of THEMES) {
      const { pairs, hues } = auditTokens(themeTokens(theme));
      const failing = [...pairs, ...hues].filter((p) => p.status === 'fail').map((p) => p.id);
      expect({ theme, failing }).toEqual({ theme, failing: [] });
    }
  });
});
