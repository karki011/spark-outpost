import { describe, expect, it } from 'vitest';
import { groupAreas, MAX_GROUPS, type GroupableArea } from './groups.ts';
import { PROJECT, sampleArea } from './map-samples.ts';

function area(root: string, files: number, category: 'core' | 'shared' | 'feature' = 'feature') {
  const id = root
    .replace(/[^a-z0-9]/g, '')
    .slice(-12)
    .padStart(12, '0');
  const entry = sampleArea({
    id,
    root,
    category,
    x: 0,
    y: 0,
    files: Array.from({ length: files }, (_, i) => ({
      path: `${root}/f${i}.ts`,
      kind: i % 2 ? 'ui' : 'api',
      x: 0,
      y: 0,
      importance: files / 1000,
    })),
  });
  return { key: `${PROJECT}:${root}`, projectId: PROJECT, area: entry } satisfies GroupableArea;
}

const paths = (groups: ReturnType<typeof groupAreas>) => groups.map((g) => g.path).sort();

describe('groupAreas', () => {
  it('groups an nx style repo by its top-level packages and folders', () => {
    const areas = [
      ...['shell', 'admin', 'portal'].map((app) => area(`apps/${app}/src`, 60)),
      ...['buttons', 'forms', 'tables', 'layout'].map((lib) =>
        area(`libs/shared/ui/${lib}`, 120, 'shared'),
      ),
      ...['auth', 'http', 'store'].map((lib) => area(`libs/shared/data/${lib}`, 90, 'core')),
      ...['orders', 'billing'].flatMap((domain) =>
        ['feature', 'data-access'].map((kind) => area(`libs/${domain}/${kind}`, 70)),
      ),
    ];
    const groups = groupAreas(areas);
    expect(paths(groups)).toEqual([
      'apps',
      'libs/billing',
      'libs/orders',
      'libs/shared/data',
      'libs/shared/ui',
    ]);
    const ui = groups.find((g) => g.path === 'libs/shared/ui')!;
    expect(ui).toMatchObject({ name: 'ui', category: 'shared', fileCount: 480, pooled: false });
    expect(ui.areaKeys).toHaveLength(4);
    expect(ui.kindCounts.ui + ui.kindCounts.api).toBe(480);
    expect(groups.find((g) => g.path === 'libs/shared/data')!.category).toBe('core');
  });

  it('merges tiny areas into one group for their parent folder', () => {
    const areas = [
      area('src/app', 400),
      area('src/api', 300),
      area('src/misc/a', 1),
      area('src/misc/b', 1),
      area('src/one', 1),
    ];
    const groups = groupAreas(areas);
    const other = groups.find((g) => g.pooled)!;
    expect(other).toMatchObject({ path: 'src', name: 'Other in src', fileCount: 3 });
    expect(other.areaKeys).toHaveLength(3);
    expect(
      groups
        .filter((g) => !g.pooled)
        .map((g) => g.path)
        .sort(),
    ).toEqual(['src/api', 'src/app']);
  });

  it('never shows more groups than the cap, pooling the smallest', () => {
    const areas = Array.from({ length: 240 }, (_, i) => area(`src/area-${i}`, 80 + (i % 7)));
    const groups = groupAreas(areas);
    expect(groups.length).toBeLessThanOrEqual(MAX_GROUPS);
    expect(groups.reduce((sum, g) => sum + g.areaKeys.length, 0)).toBe(240);
    expect(groups.filter((g) => g.pooled)).toHaveLength(1);
  });

  it('keeps each project apart and gives every group a stable id', () => {
    const web = area('web/src', 10);
    const server = { ...area('server/src', 10), projectId: 'other', key: 'other:server' };
    const groups = groupAreas([web, server]);
    expect(groups.map((g) => [g.projectId, g.id])).toEqual([
      [PROJECT, `g:${PROJECT}:web/src`],
      ['other', 'g:other:server/src'],
    ]);
    expect(groupAreas([web, server])).toEqual(groups);
  });
});
