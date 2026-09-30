import { describe, expect, it } from 'vitest';
import { EDGES, PROJECT, SERVER, WEB, sampleArea, sampleDetail, sampleMap } from './map-samples.ts';
import {
  areaForPath,
  categoryCounts,
  highlights,
  kindCounts,
  needsCheck,
  reviewOrder,
} from './map-model.ts';
import { areaKey, buildScene, fileKey } from './scene.ts';
import { locateStep } from './use-locate.ts';

const input = [{ projectId: PROJECT, name: 'app', map: sampleMap(PROJECT, [WEB, SERVER]) }];
const loaded = new Map([
  [areaKey(PROJECT, WEB.id), sampleDetail(WEB, EDGES)],
  [areaKey(PROJECT, SERVER.id), sampleDetail(SERVER, EDGES)],
]);

describe('map model', () => {
  it('finds the area whose folder holds a path', () => {
    const scene = buildScene(input, new Map());
    expect(areaForPath(scene, PROJECT, 'apps/web/src/tickets/new.ts')).toBe(
      areaKey(PROJECT, WEB.id),
    );
    expect(areaForPath(scene, PROJECT, 'README.md')).toBeNull();
  });

  it('lights changed files and, on request, the files that import them', () => {
    const scene = buildScene(input, loaded);
    const model = 'apps/web/src/tickets/ticket-model.ts';
    const only = highlights(scene, PROJECT, [model], false);
    expect([...only.changed].map((i) => scene.files[i]!.path)).toEqual([model]);
    expect(only.dependents.size).toBe(0);
    const blast = highlights(scene, PROJECT, [model], true);
    expect([...blast.dependents].map((i) => scene.files[i]!.path).sort()).toEqual([
      'apps/web/src/tickets/Tickets.tsx',
      'apps/web/src/tickets/ticket-model.test.ts',
    ]);
  });

  it('counts files per category from the area totals and per kind once all are loaded', () => {
    expect(categoryCounts(buildScene(input, new Map()))).toEqual({
      core: 3,
      shared: 0,
      feature: 4,
    });
    expect(kindCounts(buildScene(input, new Map()))).toBeNull();
    expect(kindCounts(buildScene(input, loaded))).toMatchObject({ test: 1, ui: 1 });
  });

  it('puts the least confident areas first and flags those below 0.70', () => {
    const areas = [
      sampleArea(SERVER),
      sampleArea(WEB),
      sampleArea({ ...WEB, id: 'c', confidence: null }),
    ];
    expect(reviewOrder(areas).map((area) => area.id)).toEqual(['c', WEB.id, SERVER.id]);
    expect(needsCheck(sampleArea(WEB))).toBe(true);
    expect(needsCheck({ ...sampleArea(WEB), categorySource: 'override' })).toBe(false);
    expect(needsCheck(sampleArea(SERVER))).toBe(false);
  });
});

describe('locateStep', () => {
  const wanted = { projectId: PROJECT, paths: ['apps/server/src/tickets/store.ts'] };

  it('loads the area whose folder matches first', () => {
    const step = locateStep(buildScene(input, new Map()), wanted);
    expect(step).toEqual({ state: 'looking', load: [areaKey(PROJECT, SERVER.id)] });
  });

  it('widens to every area of the project when the folder guess misses', () => {
    const odd = { projectId: PROJECT, paths: ['apps/server/src/persistence/tickets.ts'] };
    const partial = new Map([
      [
        areaKey(PROJECT, SERVER.id),
        sampleDetail({ ...SERVER, files: SERVER.files.slice(0, 1) }, EDGES),
      ],
    ]);
    const step = locateStep(buildScene(input, partial), odd);
    expect(step.load).toEqual([areaKey(PROJECT, WEB.id)]);
  });

  it('reports found and missing', () => {
    expect(locateStep(buildScene(input, loaded), wanted).state).toBe('found');
    const gone = { projectId: PROJECT, paths: ['apps/web/src/gone.ts'] };
    expect(locateStep(buildScene(input, loaded), gone).state).toBe('missing');
  });

  it('knows each file by project and path', () => {
    expect(buildScene(input, loaded).fileByKey.has(fileKey(PROJECT, wanted.paths[0]!))).toBe(true);
  });
});
