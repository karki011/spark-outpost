import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '@spark-outpost/contracts';
import type { FileRevert } from '../persistence/file-reverts.ts';
import type { ListedFile } from './change-list.ts';
import { revertsByPath, undoesRevert, withoutReverted } from './revert-filter.ts';

function listed(
  file: Pick<ChangedFile, 'path' | 'change'> & { oldPath?: string },
  before: string | null,
  after: string | null,
): ListedFile {
  return {
    file: {
      ...file,
      added: 1,
      removed: 1,
      oldText: null,
      newText: null,
      shown: 'text',
    },
    blobs: { before, after },
    contents: () => Promise.resolve({ before: null, after: null }),
  };
}

function reverted(path: string, beforeBlob: string | null, afterBlob: string | null): FileRevert {
  return { runId: 'r1', path, beforeBlob, afterBlob, revertedAt: new Date(0) };
}

describe('hiding a file revert from the change list', () => {
  it('drops a later run’s change that is exactly the revert', () => {
    const earlier = revertsByPath([reverted('a.ts', 'agent', 'start')]);
    expect(
      undoesRevert(listed({ path: 'a.ts', change: 'modified' }, 'agent', 'start'), earlier),
    ).toBe(true);
    expect(
      undoesRevert(listed({ path: 'a.ts', change: 'modified' }, 'agent', 'mine'), earlier),
    ).toBe(false);
  });

  it('matches a restored deletion and an undone rename by both sides', () => {
    const restored = revertsByPath([reverted('gone.ts', null, 'start')]);
    expect(
      undoesRevert(listed({ path: 'gone.ts', change: 'added' }, null, 'start'), restored),
    ).toBe(true);
    const moved = revertsByPath([
      reverted('old.ts', null, 'start'),
      reverted('new.ts', 'agent', null),
    ]);
    const back = listed(
      { path: 'old.ts', change: 'modified', oldPath: 'new.ts' },
      'agent',
      'start',
    );
    expect(undoesRevert(back, moved)).toBe(true);
  });

  it('hides the run’s own change to a reverted file, but not an edit you made later', () => {
    const files = [
      listed({ path: 'a.ts', change: 'modified' }, 'start', 'agent'),
      listed({ path: 'b.ts', change: 'modified' }, 'start', 'agent'),
    ];
    const own = revertsByPath([reverted('a.ts', 'agent', 'start')]);
    const earlier = revertsByPath([]);
    expect(withoutReverted(files, { own, earlier }).map((entry) => entry.file.path)).toEqual([
      'b.ts',
    ]);
    const mine = [listed({ path: 'a.ts', change: 'modified' }, 'start', 'mine')];
    expect(withoutReverted(mine, { own, earlier })).toHaveLength(1);
  });

  it('hides the run’s own rename once it was reverted', () => {
    const own = revertsByPath([
      reverted('old.ts', null, 'start'),
      reverted('new.ts', 'agent', null),
    ]);
    const moved = listed(
      { path: 'new.ts', change: 'modified', oldPath: 'old.ts' },
      'start',
      'agent',
    );
    expect(withoutReverted([moved], { own, earlier: revertsByPath([]) })).toEqual([]);
  });
});
