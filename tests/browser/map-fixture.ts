import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';
import {
  MAP_FILE_KINDS,
  type MapArea,
  type MapAreaDetail,
  type MapFileKind,
  type MapLinks,
  type MapStatus,
  type MapUnmatched,
  type ProjectMap,
} from '../../packages/contracts/src/map.ts';
import { fixtureNeighbors } from './map-neighbors.ts';

type MockFile = [string, number, string, string, number, number, number, string | null, number];
interface MockGroup {
  key: string;
  area: number;
  side: string;
  cx: number;
  cy: number;
  r: number;
}
interface MockLayout {
  pos: Record<string, [number, number]>;
  groups: MockGroup[];
  cross?: [number, number, number][];
}
interface MockData {
  repo: { built: string };
  areas: { id: string; name: string; tier: 'core' | 'shared' | 'feature'; conf: number }[];
  files: MockFile[];
  edges: [number, number][];
  changed: number[];
  layouts: Record<'mono' | 'web' | 'server', MockLayout>;
  bridges: { m: string; path: string; call: number; route: number; conf: number; type: string }[];
  unmatched: { routes: { m: string; path: string; file: number }[] };
}

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const MOCKUP = path.join(REPO_ROOT, 'docs/design/map/project-map-mockup.html');

function mockData(): MockData {
  const html = readFileSync(MOCKUP, 'utf8');
  const json = html.match(
    /<script id="map-data" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  if (!json) throw new Error('The mockup has no map data block.');
  return JSON.parse(json) as MockData;
}

export const hex12 = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12);

export interface FixtureFile {
  path: string;
  kind: MapFileKind;
  lastChangedAt: string | null;
  changeCount: number;
  authorCount: number;
  x: number;
  y: number;
  importance: number;
  fanIn: number;
  fanOut: number;
  reasons: string[];
  lines: number;
}

export interface FixtureProject {
  projectId: string;
  status: MapStatus;
  areas: MapArea[];
  areaEdges: ProjectMap['areaEdges'];
  files: Map<string, FixtureFile[]>;
  edges: [string, string][];
}

export function status(fileCount: number, areaCount: number, edgeCount: number): MapStatus {
  return {
    mapId: randomUUID(),
    status: 'ready',
    phase: 'done',
    progress: { done: fileCount, total: fileCount },
    rulesVersion: 'test',
    builtCommit: 'abc1234',
    builtAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    fileCount,
    areaCount,
    edgeCount,
    timings: {},
    jevAreas: null,
    error: null,
  };
}

const DAY_MS = 86_400_000;

function changedAt(data: MockData, day: string | null): string | null {
  if (!day) return null;
  const age = Date.parse(`${data.repo.built}T12:00:00`) - Date.parse(`${day}T12:00:00`);
  return new Date(Date.now() - Math.round(age / DAY_MS) * DAY_MS).toISOString();
}

export function kindCounts(files: readonly FixtureFile[]): Record<MapFileKind, number> {
  return Object.fromEntries(
    MAP_FILE_KINDS.map((kind) => [kind, files.filter((file) => file.kind === kind).length]),
  ) as Record<MapFileKind, number>;
}

function latestChange(files: readonly FixtureFile[]): string | null {
  return (
    files
      .map((file) => file.lastChangedAt)
      .filter((at) => at !== null)
      .sort()
      .at(-1) ?? null
  );
}

function commonFolder(paths: readonly string[]): string {
  const parts = paths.map((p) => p.split('/').slice(0, -1));
  const first = parts[0] ?? [];
  let length = 0;
  while (length < first.length && parts.every((p) => p[length] === first[length])) length += 1;
  return first.slice(0, length).join('/');
}

function projectFromLayout(
  data: MockData,
  projectId: string,
  layout: MockLayout,
  strip: string,
  keep: (file: string) => boolean,
): FixtureProject {
  const fileArea = new Map<number, MockGroup>();
  const members = new Map<string, number[]>();
  for (const group of layout.groups) members.set(group.key, []);
  for (const [index] of Object.entries(layout.pos)) {
    const file = data.files[Number(index)]!;
    if (!keep(file[0])) continue;
    const group = layout.groups.find(
      (g) => g.area === file[1] && (g.side === 'all' || g.side === file[3]),
    );
    if (!group) continue;
    fileArea.set(Number(index), group);
    members.get(group.key)!.push(Number(index));
  }
  const rel = (p: string) => p.slice(strip.length);
  const fanOut = new Map<number, number>();
  for (const [a] of data.edges) fanOut.set(a, (fanOut.get(a) ?? 0) + 1);
  const groups = layout.groups.filter((group) => (members.get(group.key) ?? []).length > 0);
  const areaId = new Map(groups.map((group) => [group.key, hex12(`${projectId}:${group.key}`)]));
  const files = new Map<string, FixtureFile[]>();
  const areas = groups.map((group): MapArea => {
    const indices = members.get(group.key)!;
    const meta = data.areas[group.area]!;
    const list = indices
      .map((index): FixtureFile => {
        const [p, , kind, , fanIn, churn, authors, lastChanged, importance] = data.files[index]!;
        const [x, y] = layout.pos[index]!;
        return {
          path: rel(p),
          kind: kind as MapFileKind,
          lastChangedAt: changedAt(data, lastChanged),
          changeCount: churn,
          authorCount: authors,
          x: x - group.cx,
          y: y - group.cy,
          importance,
          fanIn,
          fanOut: fanOut.get(index) ?? 0,
          reasons: [`imported by ${fanIn}`, `changed ${churn} times`, `${authors} authors`],
          lines: 40 + Math.round(importance * 9),
        };
      })
      .sort((a, b) => b.importance - a.importance || a.path.localeCompare(b.path));
    const id = areaId.get(group.key)!;
    files.set(id, list);
    return {
      id,
      root: commonFolder(list.map((f) => f.path)),
      source: 'merged',
      package: '',
      reason: 'Grouped by folder, imports and file names',
      name: meta.name,
      description: `${meta.name} across the app`,
      category: meta.tier,
      categorySource: 'jev',
      kind: 'domain',
      confidence: meta.conf,
      fileCount: list.length,
      lineCount: list.reduce((sum, f) => sum + f.lines, 0),
      fanIn: 0,
      fanOut: 0,
      importance: list[0]?.importance ?? 0,
      topFiles: list.slice(0, 5).map((f) => f.path),
      kindCounts: kindCounts(list),
      lastChangedAt: latestChange(list),
      x: group.cx,
      y: group.cy,
      radius: group.r,
    };
  });
  const byIndex = new Map(layout.groups.map((group, index) => [index, group]));
  const areaEdges = (layout.cross ?? []).flatMap(([a, b, weight]) => {
    const from = areaId.get(byIndex.get(a)?.key ?? '');
    const to = areaId.get(byIndex.get(b)?.key ?? '');
    return from && to ? [{ from, to, weight }] : [];
  });
  const edges = data.edges
    .filter(([a, b]) => fileArea.has(a) && fileArea.has(b))
    .map(([a, b]): [string, string] => [rel(data.files[a]![0]), rel(data.files[b]![0])]);
  const fileCount = areas.reduce((sum, area) => sum + area.fileCount, 0);
  return {
    projectId,
    status: status(fileCount, areas.length, edges.length),
    areas,
    areaEdges,
    files,
    edges,
  };
}

export class MapFixture {
  readonly projects = new Map<string, FixtureProject>();
  links: MapLinks | null = null;
  unmatched: MapUnmatched | null = null;
  changedPaths: string[] = [];
  delayMs = 0;

  add(project: FixtureProject): void {
    this.projects.set(project.projectId, project);
  }

  map(projectId: string): ProjectMap {
    const project = this.projects.get(projectId);
    if (!project) return { projectId, status: null, areas: [], areaEdges: [] };
    return {
      projectId,
      status: project.status,
      areas: project.areas,
      areaEdges: project.areaEdges,
    };
  }

  area(projectId: string, areaId: string, offset: number, limit: number): MapAreaDetail | null {
    const project = this.projects.get(projectId);
    const area = project?.areas.find((entry) => entry.id === areaId);
    if (!project || !area) return null;
    const all = project.files.get(areaId) ?? [];
    const page = all.slice(offset, offset + limit);
    const paths = new Set(page.map((file) => file.path));
    const next = offset + page.length;
    return {
      area,
      files: page.map((file) => ({ ...file, areaId, language: 'typescript' })),
      edges: project.edges
        .filter(([from, to]) => paths.has(from) || paths.has(to))
        .map(([from, to]) => ({ from, to })),
      totalFiles: all.length,
      nextOffset: next < all.length ? next : null,
    };
  }

  setCategory(
    projectId: string,
    areaId: string,
    category: MapArea['category'] | null,
  ): MapArea | null {
    const project = this.projects.get(projectId);
    const index = project?.areas.findIndex((area) => area.id === areaId) ?? -1;
    if (!project || index < 0) return null;
    const area = project.areas[index]!;
    const jev = data().areas.find((entry) => entry.name === area.name)?.tier ?? area.category;
    const next: MapArea = category
      ? { ...area, category, categorySource: 'override' }
      : { ...area, category: jev, categorySource: 'jev' };
    project.areas[index] = next;
    return next;
  }
}

let cached: MockData | null = null;
function data(): MockData {
  cached ??= mockData();
  return cached;
}

export function monoFixture(projectId: string): MapFixture {
  const fixture = new MapFixture();
  const mock = data();
  fixture.add(projectFromLayout(mock, projectId, mock.layouts.mono, '', () => true));
  fixture.changedPaths = mock.changed.map((index) => mock.files[index]![0]);
  return fixture;
}

export function combinedFixture(webId: string, serverId: string): MapFixture {
  const fixture = new MapFixture();
  const mock = data();
  const web = projectFromLayout(mock, webId, mock.layouts.web, 'apps/web/', (p) =>
    p.startsWith('apps/web/'),
  );
  const server = projectFromLayout(mock, serverId, mock.layouts.server, 'apps/server/', (p) =>
    p.startsWith('apps/server/'),
  );
  fixture.add(web);
  fixture.add(server);
  const areaOf = (project: FixtureProject, file: string) =>
    [...project.files].find(([, list]) => list.some((f) => f.path === file))?.[0];
  const links = mock.bridges.flatMap((bridge) => {
    const fromPath = mock.files[bridge.call]![0].replace('apps/web/', '');
    const toPath = mock.files[bridge.route]![0].replace('apps/server/', '');
    const fromArea = areaOf(web, fromPath);
    const toArea = areaOf(server, toPath);
    if (!fromArea || !toArea) return [];
    return [
      {
        kind: 'http' as const,
        label: `${bridge.m} ${bridge.path}`,
        fromProjectId: webId,
        toProjectId: serverId,
        fromPath,
        toPath,
        fromArea,
        toArea,
        fromLine: null,
        toLine: null,
        confidence: bridge.conf,
        source: 'rules' as const,
      },
    ];
  });
  fixture.links = {
    projects: [webId, serverId].map((projectId) => ({
      projectId,
      mapId: randomUUID(),
      status: 'ready',
    })),
    links,
    areaLinks: [],
  };
  fixture.unmatched = {
    routes: mock.unmatched.routes.map((route, index) => ({
      projectId: serverId,
      method: route.m,
      path: route.path,
      file: mock.files[route.file]![0].replace('apps/server/', ''),
      line: null,
      confirmedBy: index === 0 ? 'jev' : null,
    })),
    calls: [],
    routeTotal: mock.unmatched.routes.length,
    callTotal: 0,
    pending: false,
  };
  return fixture;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function serveMap(page: Page, fixture: MapFixture): Promise<void> {
  await page.route(/\/api\/projects\/[^/]+\/map(\/.*)?(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const [, projectId, , areaId, tail] =
      url.pathname.match(/\/api\/projects\/([^/]+)\/map(\/areas\/([^/]+)(\/category)?)?/) ?? [];
    if (fixture.delayMs) await new Promise((resolve) => setTimeout(resolve, fixture.delayMs));
    if (!projectId) return route.fallback();
    if (url.pathname.endsWith('/map/neighbors')) {
      const project = fixture.projects.get(projectId);
      const found = project
        ? fixtureNeighbors(
            project,
            url.searchParams.get('path') ?? '',
            Number(url.searchParams.get('hops') ?? 1),
          )
        : null;
      return found ? json(route, found) : json(route, { error: 'Not on the map.' }, 404);
    }
    if (!areaId) return json(route, fixture.map(projectId));
    if (tail && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { category: MapArea['category'] | null };
      const area = fixture.setCategory(projectId, areaId, body.category);
      return area ? json(route, area) : json(route, { error: 'That area is not on the map.' }, 404);
    }
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 200);
    const detail = fixture.area(projectId, areaId, offset, limit);
    return detail
      ? json(route, detail)
      : json(route, { error: 'That area is not on the map.' }, 404);
  });
  await page.route(/\/api\/map\/(links|unmatched)\?/, (route) => {
    const kind = new URL(route.request().url()).pathname.endsWith('links') ? 'links' : 'unmatched';
    const body = kind === 'links' ? fixture.links : fixture.unmatched;
    return body ? json(route, body) : json(route, { error: 'Not found' }, 404);
  });
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function spiral(index: number, spacing: number): [number, number] {
  const radius = spacing * Math.sqrt(index + 0.5);
  return [Math.cos(index * GOLDEN) * radius, Math.sin(index * GOLDEN) * radius];
}

export function syntheticFixture(
  projectId: string,
  fileCount: number,
  areaCount: number,
): MapFixture {
  const fixture = new MapFixture();
  const perArea = Math.ceil(fileCount / areaCount);
  const areaRadius = Math.sqrt(perArea) * 7 + 14;
  const name = (root: string, i: number) =>
    i % 5 === 0 ? `${root}/View-${i}.tsx` : `${root}/part-${i}.ts`;
  const files = new Map<string, FixtureFile[]>();
  const edges: [string, string][] = [];
  const areas: MapArea[] = Array.from({ length: areaCount }, (_, a) => {
    const id = hex12(`${projectId}:area-${a}`);
    const root = `src/area-${a}`;
    const list = Array.from({ length: perArea }, (_, i): FixtureFile => {
      const [x, y] = spiral(i, 7);
      const path = name(root, i);
      if (i > 0) edges.push([path, name(root, Math.floor((i - 1) / 2))]);
      return {
        path,
        kind: i % 5 === 0 ? 'ui' : 'api',
        lastChangedAt: null,
        changeCount: 0,
        authorCount: 0,
        x,
        y,
        importance: 1 / (1 + i * 0.08),
        fanIn: Math.max(0, perArea - i) % 17,
        fanOut: 1,
        reasons: [`imported by ${i % 17}`],
        lines: 40,
      };
    });
    files.set(id, list);
    const [x, y] = spiral(a, areaRadius * 1.9);
    return {
      id,
      root,
      source: 'folder',
      package: '',
      reason: 'folder',
      name: `Area ${a}`,
      description: '',
      category: (['core', 'shared', 'feature'] as const)[a % 3]!,
      categorySource: 'rules',
      kind: 'ui',
      confidence: 0.5 + (a % 50) / 100,
      fileCount: list.length,
      lineCount: list.length * 40,
      fanIn: 0,
      fanOut: 0,
      importance: 1,
      topFiles: list.slice(0, 5).map((f) => f.path),
      kindCounts: kindCounts(list),
      lastChangedAt: null,
      x,
      y,
      radius: areaRadius,
    };
  });
  const areaEdges = areas
    .slice(1)
    .map((area, index) => ({ from: area.id, to: areas[index]!.id, weight: 6 }));
  fixture.add({
    projectId,
    status: status(perArea * areaCount, areaCount, edges.length),
    areas,
    areaEdges,
    files,
    edges,
  });
  return fixture;
}
