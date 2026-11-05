import { describe, expect, it } from 'vitest';
import type { MapNeighbors } from '@spark-outpost/contracts';
import { PROJECT, SERVER, WEB, sampleMap } from '../map-samples.ts';
import { areaKey, buildScene } from '../scene.ts';
import { byArea, impactSummary } from './focus-model.ts';

const scene = buildScene(
  [{ projectId: PROJECT, name: 'App', map: sampleMap(PROJECT, [WEB, SERVER]) }],
  new Map(),
);

const neighbor = (path: string, areaId: string, importance: number, hop = 1) => ({
  path,
  areaId,
  kind: 'api' as const,
  importance,
  fanIn: 1,
  hop,
});

describe('byArea', () => {
  it('groups neighbours by area with Core areas first, keeping file order', () => {
    const groups = byArea(scene, PROJECT, [
      neighbor('web/a.ts', WEB.id, 0.9),
      neighbor('server/b.ts', SERVER.id, 0.2),
      neighbor('web/c.ts', WEB.id, 0.4, 2),
      neighbor('gone/d.ts', 'ffffffffffff', 1),
    ]);
    expect(groups.map((group) => [group.key, group.area?.category ?? null])).toEqual([
      [areaKey(PROJECT, SERVER.id), 'core'],
      [areaKey(PROJECT, WEB.id), 'feature'],
      [areaKey(PROJECT, 'ffffffffffff'), null],
    ]);
    expect(groups[1]!.files.map((file) => file.path)).toEqual(['web/a.ts', 'web/c.ts']);
  });
});

describe('impactSummary', () => {
  const base: MapNeighbors = {
    path: 'a.ts',
    areaId: WEB.id,
    hops: 1,
    imports: [],
    importedBy: [],
    importsTotal: 0,
    importedByTotal: 0,
    impact: { direct: 0, total: 0, areas: 0, coreAreas: [] },
  };

  it('says plainly when nothing depends on a file', () => {
    expect(impactSummary(base)).toEqual({
      headline: 'Nothing on the map depends on this file.',
      detail: null,
      core: null,
    });
  });

  it('counts dependents and names the Core areas they sit in', () => {
    const summary = impactSummary({
      ...base,
      impact: {
        direct: 3,
        total: 1204,
        areas: 12,
        coreAreas: [
          { id: 'x', name: 'Auth', files: 40 },
          { id: 'y', name: 'Store', files: 1 },
        ],
      },
    });
    expect(summary).toEqual({
      headline: '1,204 files depend on this, directly or through imports.',
      detail: '3 files import it directly · across 12 areas',
      core: 'Core areas affected: Auth (40), Store (1)',
    });
  });
});
