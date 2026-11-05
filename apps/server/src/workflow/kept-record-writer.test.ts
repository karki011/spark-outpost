import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { KEPT_RECORD_TITLE, keptCard, lineTotals } from './kept-record-writer.ts';

const files = [{ path: 'src/a.ts', change: 'modified' as const }];

describe('the record of changes a chat turn kept', () => {
  it('lists the files, the lines and where they are, and offers Revert', () => {
    const card = keptCard({
      files,
      level: 'full-auto',
      lines: { added: 4, removed: 1 },
      keptAt: { branch: 'spark/fix', commit: null },
    });

    expect(card.kind).toBe('accept');
    expect(card.title).toBe(KEPT_RECORD_TITLE);
    expect(card.payload).toMatchObject({
      files,
      keptBy: 'full-auto',
      lines: { added: 4, removed: 1 },
      keptAt: { branch: 'spark/fix', commit: null },
    });
    expect(card.options.map((option) => option.optionId)).toContain(CHECKPOINT_OPTION.revert);
  });

  it('carries no checks tally, note or findings', () => {
    const card = keptCard({ files, level: 'hands-off', lines: null, keptAt: null });

    expect(card.payload).toMatchObject({
      reason: '',
      checks: null,
      keptNote: null,
      laws: [],
      outsidePlan: [],
    });
  });
});

describe('the changed-lines total', () => {
  it('adds up every file', () => {
    expect(
      lineTotals([
        { path: 'a', additions: 3, deletions: 1 },
        { path: 'b', additions: 2, deletions: 4 },
      ]),
    ).toEqual({ added: 5, removed: 5 });
  });

  it('is absent when no file has a count', () => {
    expect(lineTotals([])).toBeNull();
  });
});
