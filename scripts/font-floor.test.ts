import { describe, expect, it } from 'vitest';
import { DECORATIVE_FONTS, declaredFontPx, findSmallFonts } from './font-floor.ts';
import { checkSource } from './source-rules.ts';

describe('declaredFontPx', () => {
  it('reads px and rem sizes from font-size and the font shorthand', () => {
    expect(declaredFontPx('font-size', ' 11.5px')).toBe(11.5);
    expect(declaredFontPx('font-size', '0.625rem')).toBe(10);
    expect(declaredFontPx('font', '\n    600 9px/14px Geist,\n    sans-serif')).toBe(9);
    expect(declaredFontPx('font', ' 13px/1.4 var(--font-sans)')).toBe(13);
  });

  it('leaves relative and computed sizes alone', () => {
    expect(declaredFontPx('font-size', '0.8em')).toBeNull();
    expect(declaredFontPx('font-size', 'max(12px, 0.92em)')).toBeNull();
    expect(declaredFontPx('font-size', 'var(--fs)')).toBeNull();
    expect(declaredFontPx('font', 'inherit')).toBeNull();
    expect(declaredFontPx('line-height', '10px')).toBeNull();
  });
});

describe('findSmallFonts', () => {
  it('names the line and selector of each size under 12px, inside media queries too', () => {
    const css = [
      '.ok {',
      '  font-size: 12px;',
      '}',
      '.tag,',
      '.chip {',
      '  color: red;',
      '  font-size: 11px;',
      '}',
      '@media (pointer: coarse) {',
      '  .badge {',
      '    font:',
      '      700 9px/14px Geist,',
      '      sans-serif;',
      '  }',
      '}',
    ].join('\n');
    expect(findSmallFonts(css)).toEqual([
      { line: 7, selector: '.tag, .chip', px: 11 },
      { line: 11, selector: '.badge', px: 9 },
    ]);
  });

  it('checks declarations that come before a nested rule', () => {
    const css = '.row {\n  font-size: 10px;\n  & .x {\n    font-size: 14px;\n  }\n}\n';
    expect(findSmallFonts(css)).toEqual([{ line: 2, selector: '.row', px: 10 }]);
  });
});

describe('the font floor in the source rules', () => {
  const small = '.label {\n  font-size: 11px;\n}\n';

  it('fails a web stylesheet with a size under 12px', () => {
    expect(checkSource('apps/web/src/x/x.css', small)).toEqual([
      {
        file: 'apps/web/src/x/x.css',
        line: 2,
        message: 'Font size 11px is below the 12px floor (.label); see scripts/font-floor.ts',
      },
    ]);
  });

  it('passes the decorative cases on the allowlist, matched by file and selector', () => {
    const entry = DECORATIVE_FONTS[0]!;
    const css = `${entry.selector} {\n  font-size: 9px;\n}\n`;
    expect(checkSource(entry.file, css)).toEqual([]);
    expect(checkSource('apps/web/src/other.css', css)).toHaveLength(1);
  });

  it('only checks the web app', () => {
    expect(checkSource('apps/site/src/x.css', small)).toEqual([]);
  });
});
