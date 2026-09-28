import { describe, expect, it } from 'vitest';
import { parseStatus } from './git.ts';

describe('git status parsing', () => {
  it('maps porcelain codes and strips the project prefix', () => {
    const output = [
      ' M app/a.ts',
      '?? app/new.ts',
      ' D app/gone.ts',
      'A  app/staged.ts',
      ' M other/x.ts',
      '',
    ].join('\0');
    expect(parseStatus(output, 'app/')).toEqual([
      { path: 'a.ts', change: 'modified' },
      { path: 'gone.ts', change: 'deleted' },
      { path: 'new.ts', change: 'added' },
      { path: 'staged.ts', change: 'added' },
    ]);
  });
});
