import { describe, expect, it } from 'vitest';
import { checkSource, MAX_LINES } from './source-rules.ts';

describe('checkSource', () => {
  it('accepts code without comments', () => {
    expect(checkSource('a.ts', 'const url = "http://example.com";\n')).toEqual([]);
  });

  it('flags explanatory comments in TypeScript', () => {
    const violations = checkSource('a.ts', 'const a = 1;\n// explains a\n');
    expect(violations).toEqual([{ file: 'a.ts', line: 2, message: 'Explanatory comment' }]);
  });

  it('does not mistake regular expressions or URLs for comments', () => {
    const text = "const a = '/x/node'.replace(/\\/node$/, '');\nconst b = 'http://a';\n";
    expect(checkSource('a.ts', text)).toEqual([]);
  });

  it('flags comments inside JSX and at the end of a file', () => {
    expect(checkSource('a.tsx', 'const a = <div>{/* why */}</div>;\n')).toHaveLength(1);
    expect(checkSource('a.ts', 'const a = 1;\n// trailing\n')).toHaveLength(1);
  });

  it('allows machine directives', () => {
    expect(
      checkSource('a.ts', '// eslint-disable-next-line no-console\nconsole.log(1);\n'),
    ).toEqual([]);
  });

  it('flags files over the line limit', () => {
    const text = 'x;\n'.repeat(MAX_LINES + 1);
    expect(checkSource('a.ts', text)[0]?.message).toContain('exceeds');
  });

  it('flags SQL and CSS comments', () => {
    expect(checkSource('a.sql', 'SELECT 1;\n-- why\n')).toHaveLength(1);
    expect(checkSource('a.css', '/* why */\na {}\n')).toHaveLength(1);
  });

  it('allows the shell shebang', () => {
    expect(checkSource('a.sh', '#!/usr/bin/env bash\nset -e\n')).toEqual([]);
  });

  it('flags native selects in the web app', () => {
    const text = 'export const A = () => (\n  <select aria-label="Run" />\n);\n';
    expect(checkSource('apps/web/src/a.tsx', text)).toEqual([
      {
        file: 'apps/web/src/a.tsx',
        line: 2,
        message: 'Native <select>; use ui/ChoicePicker.tsx',
      },
    ]);
    expect(checkSource('apps/server/src/a.tsx', text)).toEqual([]);
  });
});
