import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '@spark-outpost/contracts';
import { pairRenames } from './change-renames.ts';

const body = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n') + '\n';

function file(path: string, change: ChangedFile['change'], text: string | null): ChangedFile {
  return {
    path,
    change,
    added: change === 'added' ? 20 : 0,
    removed: change === 'deleted' ? 20 : 0,
    oldText: change === 'added' ? null : text,
    newText: change === 'deleted' ? null : text,
    shown: 'text',
  };
}

describe('pairRenames', () => {
  it('turns a similar delete and add into one rename with the edit counts', async () => {
    const edited = body.replace('line 3\n', 'line three\n');
    const result = await pairRenames([
      file('src/old.ts', 'deleted', body),
      file('src/new.ts', 'added', edited),
      file('README.md', 'modified', 'x\n'),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      path: 'src/new.ts',
      oldPath: 'src/old.ts',
      change: 'modified',
      added: 1,
      removed: 1,
    });
    expect(result[1]!.path).toBe('README.md');
  });

  it('leaves unrelated or empty files alone', async () => {
    const files = [
      file('a.ts', 'deleted', body),
      file('b.ts', 'added', 'something else entirely\n'),
      file('c.ts', 'deleted', ''),
      file('d.ts', 'added', ''),
    ];
    expect(await pairRenames(files)).toEqual(files);
  });
});
