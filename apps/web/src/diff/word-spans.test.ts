import { describe, expect, it } from 'vitest';
import { HUNK_PAIR_LIMIT, hunkEdits, lineEdit, type Span } from './word-spans.ts';

function marked(text: string, spans: readonly Span[]): string[] {
  return spans.map((span) => text.slice(span.from, span.to));
}

function markedEdit(before: string, after: string): [string[], string[]] | null {
  const edit = lineEdit(before, after);
  return edit && [marked(before, edit.before), marked(after, edit.after)];
}

describe('line edit', () => {
  it('marks only the word that changed', () => {
    const before = "  return count + ' ' + noun + ' changed';";
    const after = "  return count + ' ' + noun + ' updated';";
    expect(markedEdit(before, after)).toEqual([['changed'], ['updated']]);
  });

  it('marks the whole word when only part of it changed', () => {
    expect(markedEdit('const total = file1.size;', 'const total = file2.size;')).toEqual([
      ['file1'],
      ['file2'],
    ]);
  });

  it('marks an inserted argument on the new side only', () => {
    expect(markedEdit('render(view, options);', 'render(view, theme, options);')).toEqual([
      [],
      ['theme,'],
    ]);
  });

  it('joins changed words across the space between them', () => {
    const before = 'export function load(path: string, old name) {';
    const after = 'export function load(path: string, new label) {';
    expect(markedEdit(before, after)).toEqual([['old name'], ['new label']]);
  });

  it('marks nothing when a line was mostly rewritten', () => {
    expect(lineEdit('const a = 1;', 'export default function run() {}')).toBeNull();
    expect(lineEdit('}', '});')).toBeNull();
    expect(lineEdit('x', 'y')).toBeNull();
  });

  it('marks nothing when more than half of either line changed', () => {
    expect(lineEdit('foo(a)', 'foo(a, b, c, d, e, f)')).toBeNull();
    expect(markedEdit('foo(a, b, c, d)', 'foo(a, b, c, d, e)')).toEqual([[], [', e']]);
  });

  it('marks nothing for a whitespace-only change', () => {
    expect(lineEdit('  task();', '    task();')).toBeNull();
    expect(lineEdit('const a = 1;', 'const a  =  1;')).toBeNull();
    expect(lineEdit('\tdone();', '    done();')).toBeNull();
    expect(lineEdit('same', 'same')).toBeNull();
  });

  it('never marks whitespace at the edge of a span', () => {
    const edit = markedEdit('if (ready) start();', 'if (ready && armed) start();');
    expect(edit).toEqual([[], ['&& armed']]);
  });

  it('handles a one-word edit inside a very long line in linear work', () => {
    const filler = 'value, '.repeat(40_000);
    const before = `call(${filler}first);`;
    const after = `call(${filler}second);`;
    const started = performance.now();
    expect(markedEdit(before, after)).toEqual([['first'], ['second']]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('marks the changed middle of a very long line as one span or nothing', () => {
    const head = 'const table = [';
    const tail = `${' 1,'.repeat(3000)}];`;
    const before = `${head}${'a, '.repeat(900)}${tail}`;
    const after = `${head}${'b; '.repeat(900)}${tail}`;
    const edit = lineEdit(before, after);
    expect(edit?.before).toHaveLength(1);
    expect(edit?.after).toHaveLength(1);
    expect(lineEdit('a, '.repeat(900), 'b; '.repeat(900))).toBeNull();
  });

  it('does not split a surrogate pair', () => {
    const edit = lineEdit('const face = "😀"; // smile here', 'const face = "😁"; // smile here');
    expect(edit?.before).toEqual([{ from: 14, to: 16 }]);
    expect(edit?.after).toEqual([{ from: 14, to: 16 }]);
  });
});

describe('hunk edits', () => {
  it('pairs lines by position inside a small replaced hunk', () => {
    const removed = ['const a = load(path);', 'return a.size;'];
    const added = ['const a = read(path);', 'return a.length;', 'done();'];
    const edits = hunkEdits(removed, added)!;
    expect(edits).toHaveLength(2);
    expect(marked(removed[0]!, edits[0]!.before)).toEqual(['load']);
    expect(marked(added[1]!, edits[1]!.after)).toEqual(['length']);
  });

  it('marks nothing for a pure addition or a pure removal', () => {
    expect(hunkEdits([], ['const a = 1;', 'const b = 2;'])).toBeNull();
    expect(hunkEdits(['const a = 1;'], [])).toBeNull();
  });

  it('marks nothing in a rewritten block even when a few pairs look alike', () => {
    const removed = [
      'const raw = await readFile(path);',
      'let sum = 0;',
      'for (const order of orders) {',
      '  sum += order.total;',
      '  return rounded(sum);',
    ];
    const added = [
      'const orders = await loadOrders(path);',
      'const open = orders.filter(isOpen);',
      'open.forEach(assertValidTotal);',
      'if (open.length === 0) throw new Error();',
      '  return rounded(total);',
    ];
    expect(lineEdit(removed[4]!, added[4]!)).not.toBeNull();
    expect(hunkEdits(removed, added)).toBeNull();
  });

  it('marks nothing when every pair differs only in whitespace', () => {
    expect(hunkEdits(['a();', 'b();'], ['  a();', '  b();'])).toBeNull();
  });

  it('does no pairing work past the hunk cap', () => {
    const lines = (word: string, count: number) =>
      Array.from({ length: count }, (_, index) => `const row${index} = ${word}(${index});`);
    expect(
      hunkEdits(lines('load', HUNK_PAIR_LIMIT), lines('read', HUNK_PAIR_LIMIT)),
    ).not.toBeNull();
    const untouched = (count: number) =>
      new Proxy(new Array<string>(count), {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) throw new Error(`read line ${key}`);
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
    expect(hunkEdits(untouched(HUNK_PAIR_LIMIT + 1), untouched(50_000))).toBeNull();
  });
});
