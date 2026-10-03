import { describe, expect, it } from 'vitest';
import { changedRange } from './text-change.ts';

describe('changed range', () => {
  it('finds nothing when the text is the same', () => {
    expect(changedRange('a\nb\n', 'a\nb\n')).toBeNull();
  });

  it('keeps an append to the end of a growing file as one insert', () => {
    expect(changedRange('row 1\n', 'row 1\nrow 2\n')).toEqual({
      from: 6,
      to: 6,
      insert: 'row 2\n',
    });
  });

  it('replaces only the middle that changed', () => {
    expect(changedRange('one two three', 'one 2 three')).toEqual({ from: 4, to: 7, insert: '2' });
    expect(changedRange('abc', '')).toEqual({ from: 0, to: 3, insert: '' });
  });
});
