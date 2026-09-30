import { describe, expect, it } from 'vitest';
import { EDGES, PROJECT, SERVER, WEB, sampleArea, sampleDetail, sampleMap } from './map-samples.ts';
import {
  areaForPath,
  categoryCounts,
  changedAgo,
  coreImpactText,
  fileFacts,
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

  it('counts files per category and per kind from the area totals before files load', () => {
    expect(categoryCounts(buildScene(input, new Map()))).toEqual({
      core: 3,
      shared: 0,
      feature: 4,
    });
    expect(kindCounts(buildScene([], new Map()))).toBeNull();
    expect(kindCounts(buildScene(input, new Map()))).toEqual({
      ui: 2,
      api: 3,
      data: 1,
      test: 1,
      config: 0,
      other: 0,
    });
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

describe('file facts', () => {
  const now = new Date(2026, 8, 30, 15, 0).getTime();
  const file = {
    changeCount: 5,
    authorCount: 1,
    reasons: ['auth', 'changed 5 times'],
    lines: 1200,
  };

  it('says when a file last changed, how often and by how many people', () => {
    const lastChangedAt = new Date(2026, 8, 27, 9, 0).toISOString();
    expect(fileFacts({ ...file, lastChangedAt }, now)).toBe(
      'Changed 3 days ago · 5 commits · 1 author',
    );
    expect(changedAgo(new Date(2026, 8, 30, 1, 0).toISOString(), now)).toBe('today');
    expect(changedAgo(new Date(2026, 8, 29, 23, 0).toISOString(), now)).toBe('yesterday');
    expect(changedAgo(new Date(2026, 7, 2).toISOString(), now)).toBe('Aug 2');
  });

  it('falls back to the importance reasons without history', () => {
    expect(fileFacts({ ...file, lastChangedAt: null }, now)).toBe('auth · 1,200 lines');
  });
});

describe('coreImpactText', () => {
  const area = (name: string) => ({ id: name, name, files: 1 });

  it('names the Core areas a change touches and counts key files', () => {
    expect(coreImpactText({ areas: [area('auth'), area('persistence')], keyFiles: [] })).toBe(
      'Touches Core: auth, persistence',
    );
    expect(
      coreImpactText({
        areas: ['a', 'b', 'c', 'd', 'e'].map(area),
        keyFiles: ['server/db.ts'],
      }),
    ).toBe('Touches Core: a, b, c, 2 more · 1 key file');
    expect(coreImpactText({ areas: [], keyFiles: ['server/db.ts', 'web/main.tsx'] })).toBe(
      'Touches key files: db.ts, main.tsx',
    );
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
