import { describe, expect, it } from 'vitest';
import { countChangedLines, lineCount, parseCounts } from './line-counts.ts';

describe('line counts', () => {
  it('counts lines with and without a trailing newline', () => {
    expect(lineCount(null)).toBe(0);
    expect(lineCount(Buffer.from(''))).toBe(0);
    expect(lineCount(Buffer.from('a\nb\n'))).toBe(2);
    expect(lineCount(Buffer.from('a\nb'))).toBe(2);
  });

  it('parses a numstat line', () => {
    expect(parseCounts('12\t3\tfile\n')).toEqual({ added: 12, removed: 3 });
  });

  it('counts added, deleted and modified content', async () => {
    expect(await countChangedLines(null, Buffer.from('a\nb\n'))).toEqual({ added: 2, removed: 0 });
    expect(await countChangedLines(Buffer.from('a\n'), null)).toEqual({ added: 0, removed: 1 });
    expect(
      await countChangedLines(
        Buffer.from('one\ntwo\nthree\n'),
        Buffer.from('one\n2\nthree\nfour\n'),
      ),
    ).toEqual({ added: 2, removed: 1 });
  });
});
