import { describe, expect, it } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { buildDiff } from '../chat/approvals/diff-model.ts';
import { approvalHunk, firstHunk, moreLines, peekRows } from './island-diff.ts';

const numbered = (count: number, change: (line: number) => string | null = () => null) =>
  Array.from({ length: count }, (_, index) => change(index + 1) ?? `line ${index + 1}`).join('\n');

function approval(patch: Partial<Approval> = {}, payload: Partial<Approval['payload']> = {}) {
  return {
    kind: 'edit',
    reason: null,
    payload: {
      command: null,
      cwd: null,
      paths: ['src/invoice.ts'],
      diffs: [{ path: 'src/invoice.ts', oldText: 'a\n', newText: 'b\n' }],
      truncated: false,
      ...payload,
    },
    ...patch,
  } as Approval;
}

describe('the compact diff the island shows', () => {
  it('caps the peek and says how many lines are left', () => {
    const model = buildDiff(null, numbered(200));
    const shown = peekRows(model, 80);
    expect(shown.items).toHaveLength(80);
    expect(shown.hidden).toBe(120);
    expect(moreLines(shown.hidden)).toBe('120 more lines');
    expect(moreLines(1)).toBe('1 more line');
  });

  it('folds long unchanged runs in the peek instead of listing them', () => {
    const before = numbered(60);
    const after = numbered(60, (line) => (line === 30 ? 'changed' : null));
    const shown = peekRows(buildDiff(before, after));
    expect(shown.items.filter((item) => item.type === 'fold')).toHaveLength(2);
    expect(shown.items.filter((item) => item.type === 'row')).toHaveLength(8);
  });

  it('takes the first changed hunk with two lines of lead-in', () => {
    const before = numbered(80);
    const after = numbered(80, (line) => (line === 20 || line === 60 ? `new ${line}` : null));
    const shown = firstHunk(buildDiff(before, after), 10);
    const rows = shown.items.flatMap((item) => (item.type === 'row' ? [item.row] : []));
    expect(rows[0]!.text).toBe('line 18');
    expect(rows.map((row) => row.kind)).toEqual([
      'same',
      'same',
      'remove',
      'add',
      'same',
      'same',
      'same',
    ]);
    expect(shown.hidden).toBe(8);
  });

  it('caps a long first hunk and has nothing for an unchanged file', () => {
    const shown = firstHunk(buildDiff(null, numbered(40)), 10);
    expect(shown.items).toHaveLength(10);
    expect(shown.hidden).toBe(30);
    expect(firstHunk(buildDiff('same\n', 'same\n'))).toEqual({ items: [], hidden: 0 });
  });
});

describe('which approvals may show their first hunk', () => {
  it('shows the first diff of an ordinary edit', () => {
    expect(approvalHunk(approval())?.path).toBe('src/invoice.ts');
    expect(approvalHunk(approval({ kind: 'execute' }))).toBeNull();
    expect(approvalHunk(approval({}, { diffs: [] }))).toBeNull();
  });

  it('never shows a secret file, by name or by the reason Spark asked', () => {
    const env = { path: '.env.local', oldText: null, newText: 'TOKEN=abc\n' };
    expect(approvalHunk(approval({}, { paths: ['.env.local'], diffs: [env] }))).toBeNull();
    const mixed = { paths: ['src/a.ts', 'config/.env'] };
    expect(approvalHunk(approval({}, mixed))).toBeNull();
    expect(approvalHunk(approval({ reason: 'Secret files always ask' }))).toBeNull();
    expect(approvalHunk(approval({}, { asksBecause: 'Secret files always ask' }))).toBeNull();
    expect(approvalHunk(approval({}, { paths: ['.env.example'] }))?.path).toBe('src/invoice.ts');
  });

  it('keeps instruction files and git control to their paths', () => {
    expect(approvalHunk(approval({}, { instructionFiles: ['AGENTS.md'] }))).toBeNull();
    expect(approvalHunk(approval({}, { gitControl: ['.git/config'] }))).toBeNull();
  });
});
