import type { MapArea, MapAreaDetail, ProjectMap } from '@spark-outpost/contracts';
import { constellation, type Constellation } from './constellation.ts';
import { baseName, type FileKind } from './file-kind.ts';

export interface SceneProject {
  projectId: string;
  name: string;
  cx: number;
  cy: number;
  radius: number;
  tint: number;
}

export interface SceneArea {
  key: string;
  index: number;
  projectId: string;
  area: MapArea;
  x: number;
  y: number;
  r: number;
  files: number[];
  complete: boolean;
  stars: number[];
  tree: [number, number][];
}

export interface SceneFile {
  key: string;
  index: number;
  projectId: string;
  path: string;
  name: string;
  areaIndex: number;
  x: number;
  y: number;
  importance: number;
  fanIn: number;
  fanOut: number;
  lines: number;
  language: string;
  reasons: string[];
  lastChangedAt: string | null;
  changeCount: number;
  authorCount: number;
  kind: FileKind;
}

export interface Scene {
  projects: SceneProject[];
  areas: SceneArea[];
  files: SceneFile[];
  fileByKey: Map<string, number>;
  areaByKey: Map<string, number>;
  outs: number[][];
  ins: number[][];
  cross: [number, number, number][];
  bounds: [number, number, number, number];
  maxImportance: number;
}

export interface ProjectInput {
  projectId: string;
  name: string;
  map: ProjectMap;
}

export const areaKey = (projectId: string, areaId: string) => `${projectId}:${areaId}`;
export const fileKey = (projectId: string, path: string) => `${projectId}:${path}`;

const PROJECT_GAP = 0.3;
const AREA_PAD = 14;
const CROSS_PER_AREA = 2;
const EDGE_KEY = 2 ** 26;

function projectExtent(areas: readonly MapArea[]) {
  if (areas.length === 0) return { cx: 0, cy: 0, radius: 400 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const area of areas) {
    x0 = Math.min(x0, area.x - area.radius);
    y0 = Math.min(y0, area.y - area.radius);
    x1 = Math.max(x1, area.x + area.radius);
    y1 = Math.max(y1, area.y + area.radius);
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const radius = areas.reduce(
    (max, area) => Math.max(max, Math.hypot(area.x - cx, area.y - cy) + area.radius + AREA_PAD),
    0,
  );
  return { cx, cy, radius: radius * 1.06 };
}

function placeProjects(inputs: readonly ProjectInput[]): SceneProject[] {
  const extents = inputs.map((input) => projectExtent(input.map.areas));
  const width = extents.reduce((sum, e) => sum + e.radius * 2, 0);
  const gaps = extents.slice(1).reduce((sum, e) => sum + e.radius * PROJECT_GAP, 0);
  let cursor = -(width + gaps) / 2;
  return inputs.map((input, index) => {
    const extent = extents[index]!;
    const cx = cursor + extent.radius;
    cursor += extent.radius * 2 + (extents[index + 1]?.radius ?? 0) * PROJECT_GAP;
    return {
      projectId: input.projectId,
      name: input.name,
      cx,
      cy: 0,
      radius: extent.radius,
      tint: index,
    };
  });
}

const constellationCache = new WeakMap<
  MapAreaDetail,
  { paths: string[]; tree: [string, string][] }
>();

function areaConstellation(detail: MapAreaDetail, scene: Scene, area: SceneArea): Constellation {
  const cached = constellationCache.get(detail);
  const project = area.projectId;
  if (cached) {
    const index = (path: string) => scene.fileByKey.get(fileKey(project, path))!;
    return {
      stars: cached.paths.map(index),
      tree: cached.tree.map(([a, b]) => [index(a), index(b)]),
    };
  }
  const result = constellation(
    area.files,
    (file) => scene.files[file]!.importance,
    (file) => [...scene.outs[file]!, ...scene.ins[file]!],
  );
  const path = (file: number) => scene.files[file]!.path;
  constellationCache.set(detail, {
    paths: result.stars.map(path),
    tree: result.tree.map(([a, b]) => [path(a), path(b)]),
  });
  return result;
}

function addFiles(scene: Scene, area: SceneArea, detail: MapAreaDetail) {
  for (const file of detail.files) {
    const key = fileKey(area.projectId, file.path);
    if (scene.fileByKey.has(key)) continue;
    const index = scene.files.length;
    scene.fileByKey.set(key, index);
    scene.files.push({
      key,
      index,
      projectId: area.projectId,
      path: file.path,
      name: baseName(file.path),
      areaIndex: area.index,
      x: area.x + file.x,
      y: area.y + file.y,
      importance: file.importance,
      fanIn: file.fanIn,
      fanOut: file.fanOut,
      lines: file.lines,
      language: file.language,
      reasons: file.reasons,
      lastChangedAt: file.lastChangedAt,
      changeCount: file.changeCount,
      authorCount: file.authorCount,
      kind: file.kind,
    });
    scene.outs.push([]);
    scene.ins.push([]);
    area.files.push(index);
  }
  area.complete = detail.nextOffset === null;
}

function addEdges(scene: Scene, projectId: string, detail: MapAreaDetail, seen: Set<number>) {
  for (const edge of detail.edges) {
    const from = scene.fileByKey.get(fileKey(projectId, edge.from));
    const to = scene.fileByKey.get(fileKey(projectId, edge.to));
    if (from === undefined || to === undefined || from === to) continue;
    const id = from * EDGE_KEY + to;
    if (seen.has(id)) continue;
    seen.add(id);
    scene.outs[from]!.push(to);
    scene.ins[to]!.push(from);
  }
}

function crossLines(map: ProjectMap, byId: Map<string, number>): [number, number, number][] {
  const lines = map.areaEdges
    .filter((edge) => edge.from !== edge.to)
    .map((edge) => [byId.get(edge.from), byId.get(edge.to), edge.weight] as const)
    .filter(
      (line): line is [number, number, number] => line[0] !== undefined && line[1] !== undefined,
    )
    .sort((a, b) => b[2] - a[2]);
  return lines.slice(0, Math.max(4, map.areas.length * CROSS_PER_AREA));
}

function bounds(projects: readonly SceneProject[]): [number, number, number, number] {
  if (projects.length === 0) return [-500, -500, 500, 500];
  return [
    Math.min(...projects.map((p) => p.cx - p.radius)),
    Math.min(...projects.map((p) => p.cy - p.radius)),
    Math.max(...projects.map((p) => p.cx + p.radius)),
    Math.max(...projects.map((p) => p.cy + p.radius)),
  ];
}

export function buildScene(
  inputs: readonly ProjectInput[],
  details: ReadonlyMap<string, MapAreaDetail>,
): Scene {
  const projects = placeProjects(inputs);
  const scene: Scene = {
    projects,
    areas: [],
    files: [],
    fileByKey: new Map(),
    areaByKey: new Map(),
    outs: [],
    ins: [],
    cross: [],
    bounds: bounds(projects),
    maxImportance: 0,
  };
  inputs.forEach((input, projectIndex) => {
    const project = projects[projectIndex]!;
    const extent = projectExtent(input.map.areas);
    const byId = new Map<string, number>();
    for (const area of input.map.areas) {
      const key = areaKey(input.projectId, area.id);
      const index = scene.areas.length;
      byId.set(area.id, index);
      scene.areaByKey.set(key, index);
      scene.areas.push({
        key,
        index,
        projectId: input.projectId,
        area,
        x: area.x - extent.cx + project.cx,
        y: area.y - extent.cy + project.cy,
        r: area.radius + AREA_PAD,
        files: [],
        complete: false,
        stars: [],
        tree: [],
      });
    }
    scene.cross.push(...crossLines(input.map, byId));
  });
  for (const area of scene.areas) {
    const detail = details.get(area.key);
    if (detail) addFiles(scene, area, detail);
  }
  const seen = new Set<number>();
  for (const area of scene.areas) {
    const detail = details.get(area.key);
    if (!detail) continue;
    addEdges(scene, area.projectId, detail, seen);
  }
  for (const area of scene.areas) {
    const detail = details.get(area.key);
    if (!detail) continue;
    const { stars, tree } = areaConstellation(detail, scene, area);
    area.stars = stars;
    area.tree = tree;
  }
  const areaMax = scene.areas.reduce((max, area) => Math.max(max, area.area.importance), 0);
  scene.maxImportance = scene.files.reduce(
    (max, file) => Math.max(max, file.importance),
    areaMax || Number.MIN_VALUE,
  );
  return scene;
}
