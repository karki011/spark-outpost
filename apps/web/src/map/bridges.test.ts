import { describe, expect, it } from 'vitest';
import { aggregateBridges, bridgeCurve, curvePoint, likelyPath, type MapLink } from './bridges.ts';
import { EDGES, OTHER, PROJECT, SERVER, WEB, sampleDetail, sampleMap } from './map-samples.ts';
import { areaKey, buildScene, fileKey } from './scene.ts';

function link(label: string, fromPath: string, toPath: string): MapLink {
  return {
    kind: 'http',
    label,
    fromProjectId: PROJECT,
    toProjectId: OTHER,
    fromPath,
    toPath,
    fromArea: WEB.id,
    toArea: SERVER.id,
    fromLine: null,
    toLine: null,
    confidence: 0.9,
    source: 'rules',
  };
}

const CALL = 'apps/web/src/tickets/tickets-api.ts';
const ROUTE = 'apps/server/src/tickets/routes.ts';

describe('bridges', () => {
  it('groups links between the same two files and keeps the best confidence', () => {
    const bridges = aggregateBridges([
      link('GET /api/tickets', CALL, ROUTE),
      { ...link('POST /api/tickets', CALL, ROUTE), confidence: 0.95 },
      link('GET /api/other', 'apps/web/src/other.ts', ROUTE),
    ]);
    expect(bridges).toHaveLength(2);
    const busy = bridges.find((bridge) => bridge.links.length === 2)!;
    expect(busy.confidence).toBe(0.95);
    expect(busy.from).toBe(fileKey(PROJECT, CALL));
    expect(busy.toArea).toBe(areaKey(OTHER, SERVER.id));
  });

  it('bows curves away from the middle and passes through both ends', () => {
    const curve = bridgeCurve([-100, 10], [100, 10], 3, 1000);
    expect(curvePoint(curve, 0)).toEqual([-100, 10]);
    expect(curvePoint(curve, 1)).toEqual([100, 10]);
    expect(Math.abs(curvePoint(curve, 0.5)[1] - 10)).toBeGreaterThan(100);
  });

  it('traces a likely path from the calling screen to the data it reaches', () => {
    const scene = buildScene(
      [
        { projectId: PROJECT, name: 'web', map: sampleMap(PROJECT, [WEB]) },
        { projectId: OTHER, name: 'server', map: sampleMap(OTHER, [SERVER]) },
      ],
      new Map([
        [areaKey(PROJECT, WEB.id), sampleDetail(WEB, EDGES)],
        [areaKey(OTHER, SERVER.id), sampleDetail(SERVER, EDGES)],
      ]),
    );
    const [bridge] = aggregateBridges([link('GET /api/tickets', CALL, ROUTE)]);
    const names = likelyPath(scene, bridge!).map((file) => scene.files[file]!.path);
    expect(names).toEqual([
      'apps/web/src/tickets/Tickets.tsx',
      CALL,
      ROUTE,
      'apps/server/src/tickets/store.ts',
      'apps/server/src/persistence/tickets.ts',
    ]);
  });

  it('has no path until both ends are loaded', () => {
    const scene = buildScene(
      [{ projectId: PROJECT, name: 'web', map: sampleMap(PROJECT, [WEB]) }],
      new Map(),
    );
    const [bridge] = aggregateBridges([link('GET /api/tickets', CALL, ROUTE)]);
    expect(likelyPath(scene, bridge!)).toEqual([]);
  });
});
