import { describe, expect, it } from 'vitest';
import { artifactShareThemeSchema } from '@spark-outpost/contracts';
import { hexColor, shareTheme } from './share-theme.ts';

describe('hexColor', () => {
  it('reads the colour forms a browser computes', () => {
    expect(hexColor('rgb(179, 79, 0)')).toBe('#b34f00');
    expect(hexColor('rgb(255 255 255)')).toBe('#ffffff');
    expect(hexColor('rgba(36, 26, 19, 1)')).toBe('#241a13');
    expect(hexColor('color(srgb 1 0.5 0)')).toBe('#ff8000');
  });

  it('refuses see-through and unknown colours', () => {
    expect(hexColor('rgba(179, 79, 0, 0.11)')).toBeNull();
    expect(hexColor('rgb(179 79 0 / 50%)')).toBeNull();
    expect(hexColor('oklch(0.64 0.12 225)')).toBeNull();
    expect(hexColor('')).toBeNull();
  });
});

describe('shareTheme', () => {
  const apricot: Record<string, string> = {
    '--bg': 'rgb(246, 241, 237)',
    '--panel': 'rgb(255, 253, 251)',
    '--text': 'rgb(36, 26, 19)',
    '--muted': 'rgb(97, 74, 59)',
    '--line-strong': 'rgb(143, 131, 120)',
    '--accent': 'rgb(179, 79, 0)',
    '--accent-ink': 'rgb(255, 255, 255)',
    '--success': 'rgb(31, 115, 53)',
    '--danger': 'rgb(186, 49, 41)',
    '--raise': 'rgb(245, 234, 225)',
  };

  it('maps a light skin to a theme the share service accepts', () => {
    const theme = shareTheme((token) => apricot[token] ?? '');
    expect(theme).toMatchObject({ scheme: 'light', bg: '#f6f1ed', accent: '#b34f00' });
    expect(artifactShareThemeSchema.safeParse(theme).success).toBe(true);
  });

  it('calls a skin with a dark background dark', () => {
    const theme = shareTheme((token) => (token === '--bg' ? 'rgb(14, 15, 18)' : apricot[token]!));
    expect(theme?.scheme).toBe('dark');
  });

  it('sends no theme when a colour cannot be read', () => {
    expect(shareTheme((token) => (token === '--accent' ? '' : apricot[token]!))).toBeNull();
  });
});
