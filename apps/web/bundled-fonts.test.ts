import { describe, expect, it } from 'vitest';
import { bundledFonts } from './bundled-fonts.ts';

const files = bundledFonts();
const stylesheet = files.get('fonts.css')!.toString('utf8');
const faces = stylesheet.split('@font-face').slice(1);

describe('bundledFonts', () => {
  it('declares the app families over the full weight range, so bold is a real face', () => {
    const families = new Set(faces.map((face) => /font-family: '([^']+)'/.exec(face)![1]));
    expect([...families].sort()).toEqual(['Geist Mono', 'Inter']);
    for (const face of faces) expect(face).toContain('font-weight: 100 900');
  });

  it('points every face at a font file that ships beside the stylesheet', () => {
    const urls = [...stylesheet.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]!);
    expect(urls).toHaveLength(faces.length);
    for (const url of urls) {
      expect(url).toMatch(/^\.\/[a-z0-9-]+\.woff2$/);
      expect(files.get(url.slice(2))!.subarray(0, 4).toString('latin1')).toBe('wOF2');
    }
  });

  it('fetches nothing from another host', () => {
    expect(stylesheet).not.toMatch(/https?:|\/\//);
  });

  it('ships the licence notice of each family', () => {
    for (const name of ['inter-OFL.txt', 'geist-mono-OFL.txt']) {
      expect(files.get(name)!.toString('utf8')).toContain('SIL Open Font License, Version 1.1');
    }
  });
});
