import { describe, expect, it } from 'vitest';
import { areaId, buildAreas } from './areas.ts';
import { AREA_SPLIT_AT } from './policy.ts';

const PACKAGES = [
  { root: '.', name: 'shop' },
  { root: 'packages/ui', name: '@shop/ui' },
];

function many(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}/file-${String(index).padStart(3, '0')}.ts`,
  );
}

const PATHS = [
  'README.md',
  'package.json',
  'packages/ui/package.json',
  'packages/ui/src/button.tsx',
  'packages/ui/src/input.tsx',
  'docs/guide.md',
  ...many('server/orders', 70),
  ...many('server/billing', 60),
  'server/tiny/a.ts',
  'server/tiny/b.ts',
];

const EDGES: [string, string][] = [
  ['server/tiny/a.ts', 'server/billing/file-001.ts'],
  ['server/tiny/b.ts', 'server/billing/file-002.ts'],
  ['server/orders/file-000.ts', 'packages/ui/src/button.tsx'],
];

function summary(paths: readonly string[], edges: [string, string][] = EDGES) {
  return buildAreas(paths, PACKAGES, edges).map((area) => ({
    root: area.root,
    source: area.source,
    files: area.files.length,
  }));
}

describe('buildAreas', () => {
  it('groups by package, top folder and root, splits large folders and merges tiny ones by imports', () => {
    expect(summary(PATHS)).toEqual([
      { root: '(root)', source: 'root', files: 2 },
      { root: 'docs', source: 'folder', files: 1 },
      { root: 'packages/ui', source: 'package', files: 3 },
      { root: 'server/billing', source: 'merged', files: 62 },
      { root: 'server/orders', source: 'folder', files: 70 },
    ]);
    expect(PATHS.length).toBeGreaterThan(AREA_SPLIT_AT);
  });

  it('explains each area and keeps ids stable across input order and runs', () => {
    const first = buildAreas(PATHS, PACKAGES, EDGES);
    const shuffled = buildAreas([...PATHS].reverse(), PACKAGES, [...EDGES].reverse());
    expect(shuffled).toEqual(first);
    const billing = first.find((area) => area.root === 'server/billing');
    expect(billing?.id).toBe(areaId('server/billing'));
    expect(billing?.reason).toContain('merged server/tiny (2 files, 2 import links)');
  });

  it('keeps an area id when files are added or removed', () => {
    const before = buildAreas(PATHS, PACKAGES, EDGES).map((area) => area.id);
    const after = buildAreas([...PATHS, 'server/orders/new.ts'], PACKAGES, EDGES).map(
      (area) => area.id,
    );
    expect(after).toEqual(before);
  });
});
