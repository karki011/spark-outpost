import { describe, expect, it } from 'vitest';
import { fileHistory, scoreImportance } from './importance.ts';

describe('scoreImportance', () => {
  const paths = [
    'src/auth/session.ts',
    'src/util/pad.ts',
    'src/util/pad.test.ts',
    'src/feature/page.tsx',
  ];
  const scores = scoreImportance({
    paths,
    fanIn: new Map([
      ['src/util/pad.ts', 20],
      ['src/auth/session.ts', 5],
    ]),
    history: [
      { at: 300, files: ['src/auth/session.ts', 'src/feature/page.tsx'], author: 'a' },
      { at: 200, files: ['src/auth/session.ts'], author: 'b' },
      { at: 100, files: ['src/feature/page.tsx'], author: 'a' },
    ],
    ownersOf: (path) => (path.startsWith('src/auth/') ? ['@security'] : []),
  });

  it('ranks widely imported, frequently changed, owned and sensitive files above the rest', () => {
    const ranked = [...scores].sort((a, b) => b[1].score - a[1].score).map(([path]) => path);
    expect(ranked).toEqual([
      'src/auth/session.ts',
      'src/util/pad.ts',
      'src/feature/page.tsx',
      'src/util/pad.test.ts',
    ]);
  });

  it('explains every score', () => {
    expect(scores.get('src/auth/session.ts')?.reasons).toEqual([
      'imported by 5',
      'auth',
      'changed 2 times',
      '2 authors',
      'code owners',
    ]);
    expect(scores.get('src/util/pad.test.ts')?.reasons).toEqual([]);
    for (const { score } of scores.values()) expect(score).toBeGreaterThanOrEqual(0);
    for (const { score } of scores.values()) expect(score).toBeLessThanOrEqual(1);
  });

  it('keeps the last change, change count and distinct authors per file', () => {
    const history = fileHistory([
      { at: 300, files: ['a.ts', 'b.ts'], author: 'x' },
      { at: 200, files: ['a.ts'], author: 'y' },
      { at: 100, files: ['a.ts'], author: 'x' },
      { at: 50, files: ['b.ts'] },
    ]);
    expect(history.get('a.ts')).toEqual({
      count: 3,
      first: 100,
      last: 300,
      authors: new Set(['x', 'y']),
    });
    expect(history.get('b.ts')).toMatchObject({ count: 2, last: 300 });
    expect(history.get('b.ts')?.authors.size).toBe(1);
  });
});
