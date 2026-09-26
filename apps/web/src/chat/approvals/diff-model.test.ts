import { describe, expect, it } from 'vitest';
import { buildDiff, foldRows, paintLine, shownRows, type DiffRow } from './diff-model.ts';

const kinds = (rows: readonly DiffRow[]) => rows.map((row) => `${row.kind}:${row.text}`);

describe('buildDiff', () => {
  it('numbers every line of a new file as added', () => {
    const model = buildDiff(null, 'a\nb\n');
    expect(model.rows).toEqual([
      { kind: 'add', text: 'a', oldNo: null, newNo: 1, words: null },
      { kind: 'add', text: 'b', oldNo: null, newNo: 2, words: null },
    ]);
    expect([model.added, model.removed]).toEqual([2, 0]);
  });

  it('keeps shared lines and tracks old and new line numbers', () => {
    const model = buildDiff('one\ntwo\nthree\n', 'one\n2\nthree\nfour\n');
    expect(kinds(model.rows)).toEqual([
      'same:one',
      'remove:two',
      'add:2',
      'same:three',
      'add:four',
    ]);
    expect(model.rows.map((row) => [row.oldNo, row.newNo])).toEqual([
      [1, 1],
      [2, null],
      [null, 2],
      [3, 3],
      [null, 4],
    ]);
    expect([model.added, model.removed]).toEqual([2, 1]);
  });

  it('marks the changed words inside a changed line', () => {
    const [removed, added] = buildDiff('return fmt(date);\n', 'return formatDate(date);\n').rows;
    expect(removed!.words).toEqual([
      { text: 'return ', changed: false },
      { text: 'fmt', changed: true },
      { text: '(date);', changed: false },
    ]);
    expect(added!.words?.filter((part) => part.changed).map((part) => part.text)).toEqual([
      'formatDate',
    ]);
  });

  it('skips word marks when a line was mostly rewritten', () => {
    const [removed, added] = buildDiff('const a = 1;\n', 'export default function run() {}\n').rows;
    expect(removed!.words).toBeNull();
    expect(added!.words).toBeNull();
  });

  it('falls back to remove-then-add for very large rewrites', () => {
    const before = Array.from({ length: 3000 }, (_, index) => `old ${index}`).join('\n');
    const after = Array.from({ length: 3000 }, (_, index) => `new ${index}`).join('\n');
    const model = buildDiff(before, after);
    expect([model.added, model.removed]).toEqual([3000, 3000]);
  });
});

describe('foldRows', () => {
  const lines = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index}`).join('\n');

  it('folds long unchanged runs and keeps three lines of context', () => {
    const before = `${lines(20, 'a')}\nold\n${lines(20, 'b')}`;
    const after = `${lines(20, 'a')}\nnew\n${lines(20, 'b')}`;
    const blocks = foldRows(buildDiff(before, after).rows);
    expect(blocks.map((block) => [block.type, block.rows.length])).toEqual([
      ['fold', 17],
      ['rows', 8],
      ['fold', 17],
    ]);
    expect(blocks[1]!.rows[0]!.text).toBe('a17');
  });

  it('leaves short runs and pure additions unfolded', () => {
    const blocks = foldRows(buildDiff('a\nb\nc\nd\n', 'a\nb\nc\nd\ne\n').rows);
    expect(blocks.map((block) => block.type)).toEqual(['rows']);
    expect(foldRows(buildDiff(null, lines(50, 'x')).rows)).toHaveLength(1);
  });
});

describe('paintLine', () => {
  it('splits syntax tokens at word boundaries', () => {
    const tokens = [
      { content: 'return ', color: 'var(--k)' },
      { content: 'formatDate', color: 'var(--f)' },
      { content: '(date);', color: undefined },
    ];
    const words = [
      { text: 'return format', changed: false },
      { text: 'Date', changed: true },
      { text: '(date);', changed: false },
    ];
    expect(paintLine('return formatDate(date);', tokens, words)).toEqual([
      { text: 'return ', color: 'var(--k)', changed: false },
      { text: 'format', color: 'var(--f)', changed: false },
      { text: 'Date', color: 'var(--f)', changed: true },
      { text: '(date);', color: undefined, changed: false },
    ]);
  });

  it('uses plain text when tokens are missing or stale', () => {
    expect(paintLine('abc', null, null)).toEqual([
      { text: 'abc', color: undefined, changed: false },
    ]);
    expect(paintLine('abc', [{ content: 'xyz', color: 'red' }], null)).toEqual([
      { text: 'abc', color: undefined, changed: false },
    ]);
    expect(paintLine('', null, null)).toEqual([]);
  });
});

describe('shownRows', () => {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, index) => `line ${index}`).join('\n') + '\n';

  it('renders only the first chunk of a long diff and counts the rest', () => {
    const blocks = foldRows(buildDiff(null, lines(750)).rows);
    const first = shownRows(blocks, new Set(), 300);
    expect(first.items).toHaveLength(300);
    expect(first.hidden).toBe(450);
    expect(shownRows(blocks, new Set(), 900).hidden).toBe(0);
  });

  it('keeps folds closed until opened and does not count them as shown', () => {
    const before = lines(20);
    const after = before.replace('line 10\n', 'line ten\n');
    const blocks = foldRows(buildDiff(before, after).rows);
    const closed = shownRows(blocks, new Set(), 300);
    expect(closed.items.filter((item) => item.type === 'fold')).toHaveLength(2);
    const foldIndex = blocks.findIndex((block) => block.type === 'fold');
    const open = shownRows(blocks, new Set([foldIndex]), 300);
    expect(open.items.filter((item) => item.type === 'fold')).toHaveLength(1);
    expect(open.hidden).toBe(0);
  });
});
