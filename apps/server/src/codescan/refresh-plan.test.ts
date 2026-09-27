import { describe, expect, it } from 'vitest';
import { planRefresh, rebuildReason, withinCap, type CachedFile } from './refresh-plan.ts';

const cached = (path: string, size = 10, mtimeMs = 100): CachedFile => ({
  path,
  size,
  mtimeMs,
  hash: `hash-${path}`,
});

describe('planRefresh', () => {
  const known = new Map(
    ['same.ts', 'grown.ts', 'touched.ts', 'gone.ts', 'git.ts'].map((path) => [path, cached(path)]),
  );

  it('reads new and changed files, keeps the rest and removes deleted ones', () => {
    const plan = planRefresh(
      known,
      [
        { path: 'same.ts', size: 10, mtimeMs: 100 },
        { path: 'grown.ts', size: 12, mtimeMs: 100 },
        { path: 'touched.ts', size: 10, mtimeMs: 200 },
        { path: 'git.ts', size: 10, mtimeMs: 100 },
        { path: 'new.ts', size: 5, mtimeMs: 300 },
      ],
      new Set(['git.ts']),
    );
    expect(plan.read).toEqual([
      { path: 'grown.ts', knownHash: 'hash-grown.ts' },
      { path: 'touched.ts', knownHash: 'hash-touched.ts' },
      { path: 'git.ts', knownHash: 'hash-git.ts' },
      { path: 'new.ts', knownHash: null },
    ]);
    expect(plan.remove).toEqual(['gone.ts']);
    expect(plan.kept).toBe(1);
  });

  it('reads everything on a first build', () => {
    const plan = planRefresh(new Map(), [{ path: 'a.ts', size: 1, mtimeMs: 1 }], new Set());
    expect(plan).toEqual({ read: [{ path: 'a.ts', knownHash: null }], remove: [], kept: 0 });
  });
});

describe('rebuildReason', () => {
  const ready = { status: 'ready' as const, parserVersion: 'v2', fileParserVersions: ['v2'] };

  it('keeps a consistent cache', () => {
    expect(rebuildReason(ready, 'v2')).toBeNull();
    expect(rebuildReason({ ...ready, fileParserVersions: [] }, 'v2')).toBeNull();
  });

  it('rebuilds an unfinished build, a new parser or mixed rows', () => {
    expect(rebuildReason({ ...ready, status: 'building' }, 'v2')).toMatch(/did not finish/);
    expect(rebuildReason(ready, 'v3')).toMatch(/parser version changed/);
    expect(rebuildReason({ ...ready, fileParserVersions: ['v2', 'v1'] }, 'v2')).toMatch(
      /another parser version/,
    );
  });
});

describe('withinCap', () => {
  const files = [
    { path: 'old.ts', size: 1, mtimeMs: 1 },
    { path: 'newest.ts', size: 1, mtimeMs: 9 },
    { path: 'recent-in-git.ts', size: 1, mtimeMs: 2 },
    { path: 'newer.ts', size: 1, mtimeMs: 5 },
  ];

  it('keeps every file under the cap', () => {
    expect(withinCap(files, 10, new Set())).toHaveLength(4);
  });

  it('keeps recently changed files first, then the newest', () => {
    const kept = withinCap(files, 2, new Set(['recent-in-git.ts'])).map((file) => file.path);
    expect(kept).toEqual(['recent-in-git.ts', 'newest.ts']);
  });
});
