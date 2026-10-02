import { describe, expect, it } from 'vitest';
import type { ChangeEntry } from '@spark-outpost/contracts';
import { changeDiff, firstLines } from './change-diff.ts';

const entry: ChangeEntry = {
  runId: '00000000-0000-4000-8000-00000000000a',
  path: 'big.txt',
  change: 'modified',
  added: 3,
  removed: 1,
  shown: 'text',
  bytes: 40,
};

describe('file diff paging', () => {
  it('keeps the first lines and says when it cut', () => {
    expect(firstLines('a\nb\nc\n', 2)).toEqual({ text: 'a\nb\n', cut: true });
    expect(firstLines('a\nb\n', 2)).toEqual({ text: 'a\nb\n', cut: false });
    expect(firstLines('a\nb', 5)).toEqual({ text: 'a\nb', cut: false });
    expect(firstLines('a\nb\nc', undefined)).toEqual({ text: 'a\nb\nc', cut: false });
  });

  it('serves both sides up to the limit with full line counts', () => {
    const contents = { before: Buffer.from('1\n2\n'), after: Buffer.from('1\n2\n3\n4\n') };
    expect(changeDiff(entry, contents, 2)).toMatchObject({
      oldText: '1\n2\n',
      newText: '1\n2\n',
      oldLines: 2,
      newLines: 4,
      limited: true,
    });
    expect(changeDiff(entry, contents, undefined)).toMatchObject({ limited: false });
  });

  it('never sends text for binary or oversized files', () => {
    const binary = changeDiff({ ...entry, shown: 'binary' }, null, undefined);
    expect(binary).toMatchObject({ oldText: null, newText: null, limited: false });
    const added = changeDiff(
      { ...entry, change: 'added' },
      { before: null, after: Buffer.from('x\n') },
      10,
    );
    expect(added).toMatchObject({ oldText: null, newText: 'x\n', oldLines: 0, newLines: 1 });
  });
});
