import { describe, expect, it } from 'vitest';
import type { ChangeEntry } from '@spark-outpost/contracts';
import { changeEntry } from './use-turn-changes.ts';

const file = (path: string) => ({ path, added: 1, removed: 0 }) as ChangeEntry;
const files = [file('src/index.ts'), file('tests/index.ts'), file('README.md')];

describe('changeEntry', () => {
  it('matches a step path to its repository file, even when names repeat', () => {
    expect(changeEntry(files, '/work/repo/tests/index.ts')?.path).toBe('tests/index.ts');
    expect(changeEntry(files, '/work/repo/src/index.ts')?.path).toBe('src/index.ts');
    expect(changeEntry(files, 'src/index.ts')?.path).toBe('src/index.ts');
  });

  it('matches a bare name only when one file has it', () => {
    expect(changeEntry(files, 'README.md')?.path).toBe('README.md');
    expect(changeEntry(files, 'index.ts')).toBeNull();
    expect(changeEntry(files, '/elsewhere/other.ts')).toBeNull();
  });
});
