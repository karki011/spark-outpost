import { describe, expect, it } from 'vitest';
import { MAP_CATEGORIES } from '@spark-outpost/contracts';
import { LINK_KINDS } from '../bridges.ts';
import { FILE_KINDS } from '../file-kind.ts';
import { groupAreas } from '../groups.ts';
import { EDGES, OTHER, PROJECT, SERVER, WEB, sampleDetail, sampleMap } from '../map-samples.ts';
import { areaKey, buildScene } from '../scene.ts';
import { outlineReveal, outlineRows, type OutlineSource } from './outline-model.ts';

const webKey = areaKey(PROJECT, WEB.id);
const serverKey = areaKey(PROJECT, SERVER.id);
const map = sampleMap(PROJECT, [WEB, SERVER]);
map.areas[1] = { ...map.areas[1]!, lastChangedAt: '2026-09-29T10:00:00.000Z' };
const scene = buildScene(
  [{ projectId: PROJECT, name: 'App', map }],
  new Map([[webKey, sampleDetail(WEB, EDGES)]]),
);
const ALL = {
  categories: new Set(MAP_CATEGORIES),
  kinds: new Set(FILE_KINDS),
  links: new Set(LINK_KINDS),
};
const source: OutlineSource = {
  scene,
  groups: groupAreas(scene.areas),
  filters: ALL,
  changed: new Set(),
  changedAreas: new Map([[webKey, 2]]),
  projects: [{ projectId: PROJECT, name: 'App' }],
};

const names = (rows: ReturnType<typeof outlineRows>) =>
  rows.map((row) =>
    row.kind === 'area'
      ? row.area.name
      : row.kind === 'file'
        ? scene.files[row.file]!.name
        : row.kind,
  );

describe('outlineRows', () => {
  it('sorts areas by importance, name, size or most recent change', () => {
    expect(names(outlineRows(source, new Set(), 'importance'))).toEqual(['tickets', 'tickets']);
    const recent = outlineRows(source, new Set(), 'recent');
    expect(recent[0]).toMatchObject({ kind: 'area', key: serverKey });
    const files = outlineRows(source, new Set(), 'files');
    expect(files[0]).toMatchObject({ key: webKey });
    expect(files[0]).toMatchObject({ level: 1, setSize: 2, posInSet: 1, changed: 2 });
  });

  it('opens an area into its files, sorted, with loading rows for areas still on their way', () => {
    const rows = outlineRows(source, new Set([webKey, serverKey]), 'name');
    expect(rows.map((row) => [row.kind, row.level])).toEqual([
      ['area', 1],
      ['file', 2],
      ['file', 2],
      ['file', 2],
      ['file', 2],
      ['area', 1],
      ['loading', 2],
    ]);
    expect(names(rows).slice(1, 5)).toEqual([
      'ticket-model.test.ts',
      'ticket-model.ts',
      'tickets-api.ts',
      'Tickets.tsx',
    ]);
  });

  it('drops filtered areas and files', () => {
    const rows = outlineRows(
      {
        ...source,
        filters: { ...ALL, categories: new Set(['feature']), kinds: new Set(['test']) },
      },
      new Set([webKey]),
      'importance',
    );
    expect(names(rows)).toEqual(['tickets', 'ticket-model.test.ts']);
  });

  it('starts each project with its own row in a combined map', () => {
    const other = buildScene(
      [
        { projectId: PROJECT, name: 'Web', map: sampleMap(PROJECT, [WEB]) },
        { projectId: OTHER, name: 'Server', map: sampleMap(OTHER, [SERVER]) },
      ],
      new Map(),
    );
    const combined = {
      ...source,
      scene: other,
      groups: groupAreas(other.areas),
      projects: [
        { projectId: PROJECT, name: 'Web' },
        { projectId: OTHER, name: 'Server' },
      ],
    };
    const rows = outlineRows(combined, new Set([`p:${OTHER}`]), 'importance');
    expect(rows.map((row) => [row.kind, row.level])).toEqual([
      ['project', 1],
      ['project', 1],
      ['area', 2],
    ]);
    expect(outlineReveal(other, combined.groups, areaKey(OTHER, SERVER.id))).toContain(
      `p:${OTHER}`,
    );
  });
});
