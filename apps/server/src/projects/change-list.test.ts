import { describe, expect, it } from 'vitest';
import { describeRaw, parseNumstatZ, parseRawDiff } from './change-list.ts';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const ZERO = '0'.repeat(40);

describe('git change listing', () => {
  it('reads statuses, renames and blobs from raw output', () => {
    const raw = [
      `:000000 100644 ${ZERO} ${B} A`,
      'src/new.ts',
      `:100644 100644 ${A} ${B} R091`,
      'src/old-name.ts',
      'src/new-name.ts',
      `:100644 000000 ${A} ${ZERO} D`,
      'gone.md',
      '',
    ].join('\0');
    expect(parseRawDiff(raw)).toEqual([
      { change: 'added', path: 'src/new.ts', oldBlob: null, newBlob: B },
      {
        change: 'modified',
        path: 'src/new-name.ts',
        oldPath: 'src/old-name.ts',
        oldBlob: A,
        newBlob: B,
      },
      { change: 'deleted', path: 'gone.md', oldBlob: A, newBlob: null },
    ]);
  });

  it('reads line counts, binary markers and renamed targets from numstat', () => {
    const numstat = ['3\t1\tsrc/a.ts', '-\t-\tlogo.png', '1\t1\t', 'old.ts', 'new.ts', ''].join(
      '\0',
    );
    expect(parseNumstatZ(numstat)).toEqual(
      new Map([
        ['src/a.ts', { added: 3, removed: 1 }],
        ['logo.png', { added: null, removed: null }],
        ['new.ts', { added: 1, removed: 1 }],
      ]),
    );
  });

  it('marks binary and huge files without reading them', () => {
    const raw = { change: 'modified' as const, path: 'x', oldBlob: A, newBlob: B };
    const sizes = new Map([
      [A, 10],
      [B, 2 * 1024 * 1024],
    ]);
    expect(describeRaw(raw, { added: 4, removed: 2 }, sizes)).toMatchObject({
      shown: 'too-large',
      truncated: true,
      bytes: 2 * 1024 * 1024,
      added: 4,
    });
    expect(describeRaw(raw, { added: null, removed: null }, new Map())).toMatchObject({
      shown: 'binary',
      added: null,
    });
  });
});
