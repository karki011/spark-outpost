import { describe, expect, it } from 'vitest';
import { carryOver } from './carry-over.ts';
import { EDGES, OTHER, PROJECT, SERVER, WEB, sampleDetail, sampleMap } from './map-samples.ts';
import { areaKey, buildScene, fileKey } from './scene.ts';

const single = [{ projectId: PROJECT, name: 'app', map: sampleMap(PROJECT, [WEB, SERVER]) }];

describe('buildScene', () => {
  it('draws areas before their files are loaded', () => {
    const scene = buildScene(single, new Map());
    expect(scene.areas.map((area) => area.area.id)).toEqual([WEB.id, SERVER.id]);
    expect(scene.files).toHaveLength(0);
    expect(scene.cross).toEqual([[0, 1, 5]]);
  });

  it('places loaded files at their area position plus their area-local offset', () => {
    const details = new Map([[areaKey(PROJECT, WEB.id), sampleDetail(WEB, EDGES)]]);
    const scene = buildScene(single, details);
    const web = scene.areas[0]!;
    const api =
      scene.files[scene.fileByKey.get(fileKey(PROJECT, 'apps/web/src/tickets/tickets-api.ts'))!]!;
    expect(api.x - web.x).toBe(10);
    expect(api.y - web.y).toBe(4);
    expect(api.kind).toBe('api');
    expect(web.complete).toBe(true);
  });

  it('links imports in both directions and grows a constellation from the brightest file', () => {
    const details = new Map([[areaKey(PROJECT, WEB.id), sampleDetail(WEB, EDGES)]]);
    const scene = buildScene(single, details);
    const index = (path: string) => scene.fileByKey.get(fileKey(PROJECT, path))!;
    const page = index('apps/web/src/tickets/Tickets.tsx');
    const model = index('apps/web/src/tickets/ticket-model.ts');
    expect(scene.outs[page]).toContain(model);
    expect(scene.ins[model]).toContain(page);
    expect(scene.areas[0]!.stars[0]).toBe(page);
    expect(scene.areas[0]!.tree.length).toBe(scene.areas[0]!.stars.length - 1);
  });

  it('marks an area incomplete while more pages remain', () => {
    const details = new Map([[areaKey(PROJECT, WEB.id), sampleDetail(WEB, EDGES, 2)]]);
    const scene = buildScene(single, details);
    expect(scene.areas[0]!.files).toHaveLength(2);
    expect(scene.areas[0]!.complete).toBe(false);
  });

  it('lays several projects side by side without overlapping', () => {
    const scene = buildScene(
      [
        { projectId: PROJECT, name: 'web', map: sampleMap(PROJECT, [WEB]) },
        { projectId: OTHER, name: 'server', map: sampleMap(OTHER, [SERVER]) },
      ],
      new Map(),
    );
    const [left, right] = scene.projects;
    expect(left!.cx + left!.radius).toBeLessThan(right!.cx - right!.radius);
    expect(scene.areas[0]!.x).toBeCloseTo(left!.cx);
    expect(scene.areas[1]!.x).toBeCloseTo(right!.cx);
  });

  it('keeps hover and focus on the same file when a rebuild renumbers files', () => {
    const late = new Map([[areaKey(PROJECT, SERVER.id), sampleDetail(SERVER, EDGES)]]);
    const before = buildScene(single, late);
    const both = new Map([...late, [areaKey(PROJECT, WEB.id), sampleDetail(WEB, EDGES)]]);
    const after = buildScene(single, both);
    const store = before.fileByKey.get(fileKey(PROJECT, 'apps/server/src/tickets/store.ts'))!;
    const kept = carryOver(before, after, {
      focusFile: store,
      focusArea: 1,
      hover: { type: 'file', index: store },
      pinned: null,
    });
    expect(after.files[kept.focusFile]!.path).toBe('apps/server/src/tickets/store.ts');
    expect(kept.hover).toEqual({ type: 'file', index: kept.focusFile });
    expect(after.areas[kept.focusArea]!.area.id).toBe(SERVER.id);
  });
});
