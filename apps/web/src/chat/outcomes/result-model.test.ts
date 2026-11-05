import { describe, expect, it } from 'vitest';
import type { PrWatch } from '@spark-outpost/contracts';
import { keptAtLine, keptLine, pullReferences } from './result-model.ts';

const watch = (number: number, via: PrWatch['opened']['via'], at: string, draft = false) =>
  ({
    number,
    url: `https://github.com/o/r/pull/${number}`,
    opened: { via, at },
    prState: number === 3 ? 'merged' : 'open',
    draft,
  }) as PrWatch;

describe('result line', () => {
  it('counts files and lines', () => {
    const files = [{ path: 'a.ts', change: 'modified' as const }];
    expect(keptLine({ files, lines: { added: 4, removed: 2 } })).toBe('Kept · 1 file · +4 −2');
    expect(keptLine({ files: [...files, ...files], lines: null })).toBe('Kept · 2 files');
    expect(keptLine({ files: [], lines: null })).toBe('Kept · no file changes');
  });

  it('refers to the pull requests this chat opened, newest first, two at most', () => {
    const pulls = pullReferences([
      watch(1, 'agent', '2026-10-01T10:00:00Z'),
      watch(2, 'discovery', '2026-10-02T10:00:00Z'),
      watch(3, 'ship', '2026-10-03T10:00:00Z'),
      watch(4, 'agent', '2026-10-04T10:00:00Z', true),
    ]);
    expect(pulls.map((pull) => pull.number)).toEqual([4, 3]);
    expect(pulls.map((pull) => pull.state)).toEqual(['Draft', 'Merged']);
  });

  it('names the branch and the commit, or says the change is not committed', () => {
    expect(keptAtLine(null)).toBeNull();
    expect(keptAtLine({ branch: null, commit: 'abc1234' })).toBeNull();
    expect(keptAtLine({ branch: 'spark/notes-1', commit: 'abc1234' })).toBe(
      'spark/notes-1 · abc1234',
    );
    expect(keptAtLine({ branch: 'spark/notes-1', commit: null })).toBe(
      'spark/notes-1 · not committed',
    );
  });
});
