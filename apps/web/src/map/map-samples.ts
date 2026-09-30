import type { MapArea, MapAreaDetail, MapCategory, ProjectMap } from '@spark-outpost/contracts';

export const PROJECT = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';

interface SampleArea {
  id: string;
  root: string;
  category?: MapCategory;
  confidence?: number | null;
  x: number;
  y: number;
  files: { path: string; x: number; y: number; importance: number }[];
}

export function sampleArea(area: SampleArea): MapArea {
  return {
    id: area.id,
    root: area.root,
    source: 'folder',
    package: '',
    reason: 'folder',
    name: area.root.split('/').pop() || 'root',
    description: '',
    category: area.category ?? 'feature',
    categorySource: 'jev',
    kind: 'ui',
    confidence: area.confidence === undefined ? 0.9 : area.confidence,
    fileCount: area.files.length,
    lineCount: 10 * area.files.length,
    fanIn: 0,
    fanOut: 0,
    importance: Math.max(0, ...area.files.map((file) => file.importance)),
    topFiles: area.files.map((file) => file.path).slice(0, 5),
    x: area.x,
    y: area.y,
    radius: 40,
  };
}

export function sampleMap(projectId: string, areas: SampleArea[]): ProjectMap {
  return {
    projectId,
    status: null,
    areas: areas.map(sampleArea),
    areaEdges: areas.length > 1 ? [{ from: areas[0]!.id, to: areas[1]!.id, weight: 5 }] : [],
  };
}

export function sampleDetail(
  area: SampleArea,
  edges: [string, string][],
  limit = area.files.length,
): MapAreaDetail {
  const files = [...area.files].sort((a, b) => b.importance - a.importance).slice(0, limit);
  return {
    area: sampleArea(area),
    files: files.map((file) => ({
      ...file,
      areaId: area.id,
      language: 'typescript',
      lines: 10,
      fanIn: edges.filter(([, to]) => to === file.path).length,
      fanOut: edges.filter(([from]) => from === file.path).length,
      reasons: [],
    })),
    edges: edges
      .filter(([from, to]) => files.some((file) => file.path === from || file.path === to))
      .map(([from, to]) => ({ from, to })),
    totalFiles: area.files.length,
    nextOffset: limit < area.files.length ? limit : null,
  };
}

export const WEB: SampleArea = {
  id: 'aaaaaaaaaaaa',
  root: 'apps/web/src/tickets',
  category: 'feature',
  confidence: 0.62,
  x: 100,
  y: 0,
  files: [
    { path: 'apps/web/src/tickets/Tickets.tsx', x: 0, y: 0, importance: 0.9 },
    { path: 'apps/web/src/tickets/tickets-api.ts', x: 10, y: 4, importance: 0.7 },
    { path: 'apps/web/src/tickets/ticket-model.ts', x: -8, y: 6, importance: 0.5 },
    { path: 'apps/web/src/tickets/ticket-model.test.ts', x: 4, y: -9, importance: 0.1 },
  ],
};

export const SERVER: SampleArea = {
  id: 'bbbbbbbbbbbb',
  root: 'apps/server/src/tickets',
  category: 'core',
  confidence: 0.95,
  x: -100,
  y: 20,
  files: [
    { path: 'apps/server/src/tickets/routes.ts', x: 0, y: 0, importance: 0.8 },
    { path: 'apps/server/src/tickets/store.ts', x: 6, y: 6, importance: 0.6 },
    { path: 'apps/server/src/persistence/tickets.ts', x: -6, y: 6, importance: 0.4 },
  ],
};

export const EDGES: [string, string][] = [
  ['apps/web/src/tickets/Tickets.tsx', 'apps/web/src/tickets/tickets-api.ts'],
  ['apps/web/src/tickets/Tickets.tsx', 'apps/web/src/tickets/ticket-model.ts'],
  ['apps/web/src/tickets/ticket-model.test.ts', 'apps/web/src/tickets/ticket-model.ts'],
  ['apps/server/src/tickets/routes.ts', 'apps/server/src/tickets/store.ts'],
  ['apps/server/src/tickets/store.ts', 'apps/server/src/persistence/tickets.ts'],
];
