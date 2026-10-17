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

  it('hides the run’s own reverted file only while its range is fixed', () => {
    const files = [
      listed({ path: 'a.ts', change: 'modified' }, 'start', 'agent'),
      listed({ path: 'b.ts', change: 'modified' }, 'start', 'agent'),
    ];
    const own = [reverted('a.ts', 'agent', 'start')];
    const earlier = revertsByPath([]);
    const fixed = withoutReverted(files, { own, earlier, fixedRange: true });
    const live = withoutReverted(files, { own, earlier, fixedRange: false });
    expect(fixed.map((entry) => entry.file.path)).toEqual(['b.ts']);
    expect(live.map((entry) => entry.file.path)).toEqual(['a.ts', 'b.ts']);
  });
});
