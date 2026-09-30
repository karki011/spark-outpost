import { describe, expect, it } from 'vitest';
import { MAP_CATEGORIES } from '@spark-outpost/contracts';
import { LINK_KINDS } from '../bridges.ts';
import { FILE_KINDS } from '../file-kind.ts';
import { groupAreas } from '../groups.ts';
import { EDGES, PROJECT, SERVER, WEB, sampleDetail, sampleMap } from '../map-samples.ts';
import { areaKey, buildScene, fileKey } from '../scene.ts';
import {
  buildTree,
  revealIds,
  visibleEdges,
  type TreeSource,
  type TreeState,
} from './tree-model.ts';

const map = sampleMap(PROJECT, [WEB, SERVER]);
const webKey = areaKey(PROJECT, WEB.id);
const serverKey = areaKey(PROJECT, SERVER.id);
const details = new Map([
  [webKey, sampleDetail(WEB, EDGES)],
  [serverKey, sampleDetail(SERVER, EDGES)],
]);
const scene = buildScene([{ projectId: PROJECT, name: 'App', map }], details);
const groups = groupAreas(scene.areas);
const ALL = {
  categories: new Set(MAP_CATEGORIES),
  kinds: new Set(FILE_KINDS),
  links: new Set(LINK_KINDS),
};

function source(overrides: Partial<TreeSource> = {}): TreeSource {
  return {
    scene,
    groups,
    areaLinks: [{ from: webKey, to: serverKey, weight: 5 }],
    details,
    filters: ALL,
    changed: new Set(),
    changedAreas: new Map(),
    bridges: [],
    projects: [{ projectId: PROJECT, name: 'App' }],
    ...overrides,
  };
}

const state = (expanded: string[] = [], pinned: string[] = []): TreeState => ({
  expanded: new Set(expanded),
  limits: new Map(),
  pinned: new Set(pinned),
});

describe('buildTree', () => {
  it('shows one node per group with the weighted import between them', () => {
    const graph = buildTree(source(), state());
    expect(graph.items.map((item) => [item.kind, item.id])).toEqual([
      ['area', webKey],
      ['area', serverKey],
    ]);
    expect(graph.edges).toEqual([
      {
        id: `e:${webKey}>${serverKey}`,
        source: webKey,
        target: serverKey,
        weight: 5,
        bridge: null,
      },
    ]);
    expect(graph.layout.nodes.every((node) => node.width > 0 && !node.container)).toBe(true);
  });

  it('opens an area into its files and draws file level imports inside it', () => {
    const graph = buildTree(source(), state([webKey]));
    const files = graph.items.filter((item) => item.kind === 'file');
    expect(files.map((item) => item.parent)).toEqual([webKey, webKey, webKey, webKey]);
    expect(graph.items.find((item) => item.id === webKey)!.container).toBe(true);
    const tickets = `f:${fileKey(PROJECT, 'apps/web/src/tickets/Tickets.tsx')}`;
    expect(graph.edges.map((edge) => edge.source)).toContain(tickets);
    expect(graph.edges.some((edge) => edge.target === serverKey)).toBe(false);
  });

  it('shows a loading node until an opened area has its files', () => {
    const graph = buildTree(
      source({ scene: buildScene([{ projectId: PROJECT, name: 'App', map }], new Map()) }),
      state([webKey]),
    );
    expect(graph.items.filter((item) => item.parent === webKey).map((item) => item.kind)).toEqual([
      'loading',
    ]);
  });

  it('hides areas and files the filters leave out and marks changed files', () => {
    const changed = scene.fileByKey.get(fileKey(PROJECT, 'apps/web/src/tickets/Tickets.tsx'))!;
    const graph = buildTree(
      source({
        filters: { ...ALL, categories: new Set(['feature']), kinds: new Set(['ui']) },
        changed: new Set([changed]),
        changedAreas: new Map([[webKey, 1]]),
      }),
      state([webKey]),
    );
    expect(graph.items.find((item) => item.id === serverKey)).toBeUndefined();
    const files = graph.items.filter((item) => item.kind === 'file');
    expect(files).toHaveLength(2);
    expect(files.filter((item) => item.kind === 'file' && item.changed)).toHaveLength(1);
    expect(graph.items.find((item) => item.id === webKey)).toMatchObject({ changed: 1 });
  });

  it('keeps only the strongest links on the strong level', () => {
    const areaLinks = Array.from({ length: 12 }, (_, i) => ({
      from: i % 2 ? webKey : serverKey,
      to: i % 2 ? serverKey : webKey,
      weight: i,
    }));
    const graph = buildTree(source({ areaLinks }), state());
    expect(graph.edges.map((edge) => edge.weight).sort()).toEqual([30, 36]);
    expect(visibleEdges(graph, 'strong')).toHaveLength(2);
  });

  it('reveals a file by opening its group, area and folder and pinning it', () => {
    const file = scene.fileByKey.get(fileKey(PROJECT, 'apps/server/src/persistence/tickets.ts'))!;
    const { expand, target } = revealIds(scene, groups, serverKey, file);
    expect(expand).toContain(serverKey);
    const graph = buildTree(source(), state(expand, [target]));
    expect(graph.items.some((item) => item.id === target)).toBe(true);
  });

  it('splits a big area into its folders below the shared prefix', () => {
    const big = {
      id: 'cccccccccccc',
      root: 'libs/ui',
      x: 0,
      y: 0,
      files: Array.from({ length: 14 }, (_, i) => ({
        path: `libs/ui/src/${i % 2 ? 'forms' : 'tables'}/part-${i}.tsx`,
        kind: 'ui' as const,
        x: 0,
        y: 0,
        importance: 1 - i / 20,
      })),
    };
    const bigMap = sampleMap(PROJECT, [big]);
    const key = areaKey(PROJECT, big.id);
    const bigScene = buildScene(
      [{ projectId: PROJECT, name: 'App', map: bigMap }],
      new Map([[key, sampleDetail(big, [])]]),
    );
    const bigGroups = groupAreas(bigScene.areas);
    const graph = buildTree(
      source({ scene: bigScene, groups: bigGroups, areaLinks: [], details: new Map() }),
      state([key, `d:${key}:forms`]),
    );
    const folders = graph.items.filter((item) => item.kind === 'folder');
    expect(folders.map((item) => item.kind === 'folder' && [item.path, item.files])).toEqual([
      ['forms', 7],
      ['tables', 7],
    ]);
    expect(graph.items.filter((item) => item.parent === `d:${key}:forms`)).toHaveLength(7);
  });

  it('shows the first areas of a big group and gathers the rest in a more node', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `${i}`.padStart(12, 'd'),
      root: `src/pkg/area-${i}`,
      x: 0,
      y: 0,
      files: [
        {
          path: `src/pkg/area-${i}/a.ts`,
          kind: 'api' as const,
          x: 0,
          y: 0,
          importance: 1 - i / 100,
        },
      ],
    }));
    const manyScene = buildScene(
      [{ projectId: PROJECT, name: 'App', map: sampleMap(PROJECT, many) }],
      new Map(),
    );
    const pool = {
      ...groupAreas(manyScene.areas)[0]!,
      id: 'g:pool',
      areaKeys: manyScene.areas.map((entry) => entry.key),
    };
    const manyGroups = [pool];
    const hiddenKey = areaKey(PROJECT, many[29]!.id);
    const graph = buildTree(
      source({ scene: manyScene, groups: manyGroups, areaLinks: [], details: new Map() }),
      state([pool.id], [hiddenKey]),
    );
    const inside = graph.items.filter((item) => item.parent === pool.id);
    expect(inside.filter((item) => item.kind === 'area')).toHaveLength(25);
    expect(inside.find((item) => item.kind === 'more')).toMatchObject({ hidden: 5, unit: 'area' });
    expect(inside.some((item) => item.id === hiddenKey)).toBe(true);
  });
});
