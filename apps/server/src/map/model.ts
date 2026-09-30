import type { MapCategory, MapKind } from '@spark-outpost/contracts';
import type { Commit } from '../codescan/git.ts';
import type { WorkspacePackage } from '../codescan/layout.ts';
import { ownersMatcher, type OwnerRule } from '../codescan/owners.ts';
import { buildAreas, type Area, type AreaSource } from './areas.ts';
import { buildGraph, type SourceFile } from './graph.ts';
import { scoreImportance } from './importance.ts';
import { extent, FILE_LAYOUT, layoutNodes, SKY_LAYOUT, type Point } from './layout.ts';
import { AREA_TOP_FILES } from './policy.ts';
import type { Resolver } from './resolve.ts';
import { ruleCategory, ruleKind } from './rules.ts';

export interface MapFile {
  path: string;
  areaId: string;
  language: string;
  lines: number;
  fanIn: number;
  fanOut: number;
  importance: number;
  reasons: string[];
  x: number;
  y: number;
}

export interface MapAreaRow {
  id: string;
  root: string;
  source: AreaSource;
  package: string;
  reason: string;
  fileCount: number;
  lineCount: number;
  fanIn: number;
  fanOut: number;
  importance: number;
  topFiles: string[];
  ruleCategory: MapCategory;
  ruleKind: MapKind;
  x: number;
  y: number;
  radius: number;
}

export interface AreaEdge {
  from: string;
  to: string;
  weight: number;
}

export interface MapModel {
  files: MapFile[];
  edges: [string, string][];
  areas: MapAreaRow[];
  areaEdges: AreaEdge[];
}

export interface PreviousLayout {
  files: ReadonlyMap<string, Point & { areaId: string }>;
  areas: ReadonlyMap<string, Point & { radius: number }>;
}

export interface ModelInput {
  files: readonly SourceFile[];
  packages: readonly WorkspacePackage[];
  owners: readonly OwnerRule[];
  history: readonly Commit[];
  resolver: Resolver;
  previous: PreviousLayout;
  yieldNow: () => Promise<void>;
}

const GROWTH_UNPINS = 0.15;

function areaEdges(
  edges: readonly [string, string][],
  areaOf: ReadonlyMap<string, string>,
): AreaEdge[] {
  const weights = new Map<string, number>();
  for (const [from, to] of edges) {
    const a = areaOf.get(from);
    const b = areaOf.get(to);
    if (!a || !b || a === b) continue;
    weights.set(`${a}\u0000${b}`, (weights.get(`${a}\u0000${b}`) ?? 0) + 1);
  }
  return [...weights]
    .map(([key, weight]) => {
      const [from, to] = key.split('\u0000') as [string, string];
      return { from, to, weight };
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

async function layoutFiles(
  input: ModelInput,
  area: Area,
  intra: readonly [string, string][],
  importance: ReadonlyMap<string, number>,
): Promise<{ positions: Map<string, Point>; radius: number }> {
  const nodes = area.files.map((path) => {
    const previous = input.previous.files.get(path);
    return {
      id: path,
      size: 2,
      weight: importance.get(path) ?? 0,
      previous: previous && previous.areaId === area.id ? { x: previous.x, y: previous.y } : null,
    };
  });
  const edges = intra.map(([from, to]) => ({ from, to, weight: 1 }));
  const positions = layoutNodes(nodes, edges, FILE_LAYOUT);
  await input.yieldNow();
  return { positions, radius: extent(positions.values(), FILE_LAYOUT.spacing) };
}

function skyLayout(input: ModelInput, areas: MapAreaRow[], edges: readonly AreaEdge[]) {
  const nodes = areas.map((area) => {
    const previous = input.previous.areas.get(area.id);
    const grew =
      previous && Math.abs(area.radius - previous.radius) > previous.radius * GROWTH_UNPINS;
    return {
      id: area.id,
      size: area.radius,
      weight: area.importance,
      previous: previous && !grew ? { x: previous.x, y: previous.y } : null,
    };
  });
  const positions = layoutNodes(nodes, edges, SKY_LAYOUT);
  for (const area of areas) {
    const point = positions.get(area.id) ?? { x: 0, y: 0 };
    area.x = point.x;
    area.y = point.y;
  }
}

function edgesWithinAreas(
  edges: readonly [string, string][],
  areaOf: ReadonlyMap<string, string>,
): Map<string, [string, string][]> {
  const within = new Map<string, [string, string][]>();
  for (const edge of edges) {
    const area = areaOf.get(edge[0]);
    if (!area || area !== areaOf.get(edge[1])) continue;
    const list = within.get(area) ?? [];
    list.push(edge);
    within.set(area, list);
  }
  return within;
}

function neighbourCounts(edges: readonly AreaEdge[]) {
  const usedBy = new Map<string, number>();
  const uses = new Map<string, number>();
  for (const edge of edges) {
    usedBy.set(edge.to, (usedBy.get(edge.to) ?? 0) + 1);
    uses.set(edge.from, (uses.get(edge.from) ?? 0) + 1);
  }
  return { usedBy, uses };
}

export async function buildModel(input: ModelInput): Promise<MapModel> {
  const graph = buildGraph(input.files, input.resolver);
  await input.yieldNow();
  const paths = input.files.map((file) => file.path);
  const areas = buildAreas(paths, input.packages, graph.edges);
  const scores = scoreImportance({
    paths,
    fanIn: graph.fanIn,
    history: input.history,
    ownersOf: ownersMatcher(input.owners),
  });
  const areaOf = new Map(
    areas.flatMap((area) => area.files.map((path) => [path, area.id] as const)),
  );
  const byPath = new Map(input.files.map((file) => [file.path, file]));
  const importance = new Map([...scores].map(([path, value]) => [path, value.score]));
  const interArea = areaEdges(graph.edges, areaOf);
  const { usedBy, uses } = neighbourCounts(interArea);
  const intraByArea = edgesWithinAreas(graph.edges, areaOf);
  const files: MapFile[] = [];
  const rows: MapAreaRow[] = [];
  for (const area of areas) {
    const intra = intraByArea.get(area.id) ?? [];
    const { positions, radius } = await layoutFiles(input, area, intra, importance);
    const ranked = [...area.files].sort(
      (a, b) => (importance.get(b) ?? 0) - (importance.get(a) ?? 0) || a.localeCompare(b),
    );
    const facts = {
      root: area.root,
      source: area.source,
      files: area.files.map((path) => ({
        path,
        language: byPath.get(path)?.language ?? 'text',
        routes:
          byPath.get(path)?.endpoints.filter((endpoint) => endpoint.kind === 'route').length ?? 0,
      })),
      usedBy: usedBy.get(area.id) ?? 0,
      uses: uses.get(area.id) ?? 0,
    };
    const kind = ruleKind(facts);
    rows.push({
      id: area.id,
      root: area.root,
      source: area.source,
      package: area.package,
      reason: area.reason,
      fileCount: area.files.length,
      lineCount: area.files.reduce((sum, path) => sum + (byPath.get(path)?.lines ?? 0), 0),
      fanIn: interArea
        .filter((edge) => edge.to === area.id)
        .reduce((sum, edge) => sum + edge.weight, 0),
      fanOut: interArea
        .filter((edge) => edge.from === area.id)
        .reduce((sum, edge) => sum + edge.weight, 0),
      importance: importance.get(ranked[0] ?? '') ?? 0,
      topFiles: ranked.slice(0, AREA_TOP_FILES),
      ruleCategory: ruleCategory(facts, kind),
      ruleKind: kind,
      x: 0,
      y: 0,
      radius,
    });
    for (const path of area.files) {
      const file = byPath.get(path);
      const point = positions.get(path) ?? { x: 0, y: 0 };
      files.push({
        path,
        areaId: area.id,
        language: file?.language ?? 'text',
        lines: file?.lines ?? 0,
        fanIn: graph.fanIn.get(path) ?? 0,
        fanOut: graph.fanOut.get(path) ?? 0,
        importance: importance.get(path) ?? 0,
        reasons: scores.get(path)?.reasons ?? [],
        x: point.x,
        y: point.y,
      });
    }
  }
  skyLayout(input, rows, interArea);
  return { files, edges: graph.edges, areas: rows, areaEdges: interArea };
}
