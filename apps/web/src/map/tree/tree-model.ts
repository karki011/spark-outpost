import type { MapArea, MapAreaDetail } from '@spark-outpost/contracts';
import type { Bridge, LinkKind } from '../bridges.ts';
import type { FileKind } from '../file-kind.ts';
import type { MapFilters } from '../frame.ts';
import type { MapGroup } from '../groups.ts';
import { areaForPath } from '../map-model.ts';
import { fileKey, type Scene, type SceneArea } from '../scene.ts';
import type { LayoutInput } from './tree-layout.ts';

interface Base {
  id: string;
  parent: string | null;
  container: boolean;
}

export type TreeItem = Base &
  (
    | { kind: 'project'; projectId: string; name: string }
    | { kind: 'group'; group: MapGroup; areas: MapArea[]; files: number; changed: number }
    | { kind: 'area'; area: MapArea; changed: number }
    | { kind: 'folder'; path: string; files: number; changed: number }
    | {
        kind: 'file';
        file: number;
        path: string;
        name: string;
        fileKind: FileKind;
        fanIn: number;
        changed: boolean;
      }
    | { kind: 'more'; hidden: number; owner: string; unit: 'file' | 'area' }
    | { kind: 'loading' }
  );

export type TreeKind = TreeItem['kind'];

export interface TreeEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  bridge: LinkKind[] | null;
}

export interface TreeGraph {
  items: TreeItem[];
  edges: TreeEdge[];
  layout: LayoutInput;
}

export interface TreeState {
  expanded: ReadonlySet<string>;
  limits: ReadonlyMap<string, number>;
  pinned: ReadonlySet<string>;
}

export interface AreaLink {
  from: string;
  to: string;
  weight: number;
}

export interface TreeSource {
  scene: Scene;
  groups: readonly MapGroup[];
  areaLinks: readonly AreaLink[];
  details: ReadonlyMap<string, MapAreaDetail>;
  filters: MapFilters;
  changed: ReadonlySet<number>;
  changedAreas: ReadonlyMap<string, number>;
  bridges: readonly Bridge[];
  projects: readonly { projectId: string; name: string }[];
}

export type EdgeLevel = 'strong' | 'more' | 'all';

export const FILE_LIMIT = 24;
export const AREA_LIMIT = 24;
const FOLDERS_ABOVE = 12;
const MIN_EDGES = 6;
const EDGE_FACTOR: Record<EdgeLevel, number> = { strong: 1.2, more: 3, all: Infinity };

export const SIZES: Record<TreeKind, { width: number; height: number }> = {
  project: { width: 300, height: 120 },
  group: { width: 256, height: 108 },
  area: { width: 256, height: 108 },
  folder: { width: 224, height: 52 },
  file: { width: 224, height: 46 },
  more: { width: 224, height: 40 },
  loading: { width: 224, height: 96 },
};

export const fileNodeId = (key: string) => `f:${key}`;
const folderId = (areaKey: string, folder: string) => `d:${areaKey}:${folder}`;
const moreId = (owner: string) => `m:${owner}`;

export function folderBase(paths: readonly string[]): string {
  const dirs = paths.map((path) => path.split('/').slice(0, -1));
  const first = dirs[0] ?? [];
  let length = 0;
  while (length < first.length && dirs.every((dir) => dir[length] === first[length])) length += 1;
  return first.slice(0, length).join('/');
}

export function folderIn(base: string, path: string): string {
  const rel = base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
  const slash = rel.indexOf('/');
  return slash < 0 ? '' : rel.slice(0, slash);
}

class Builder {
  readonly items: TreeItem[] = [];
  readonly parentOf = new Map<string, string | null>();
  readonly areaRep = new Map<string, string>();
  readonly fileRep = new Map<number, string>();
  readonly open = new Set<string>();

  constructor(
    private readonly source: TreeSource,
    private readonly state: TreeState,
  ) {}

  private add(item: TreeItem) {
    this.items.push(item);
    this.parentOf.set(item.id, item.parent);
  }

  private changedIn(files: readonly number[]): number {
    return files.filter((file) => this.source.changed.has(file)).length;
  }

  project(projectId: string, name: string, combined: boolean) {
    const parent = combined ? `p:${projectId}` : null;
    if (parent)
      this.add({ id: parent, parent: null, container: true, kind: 'project', projectId, name });
    const { scene, filters } = this.source;
    for (const group of this.source.groups) {
      if (group.projectId !== projectId) continue;
      const areas = group.areaKeys
        .map((key) => scene.areas[scene.areaByKey.get(key) ?? -1])
        .filter(
          (entry): entry is SceneArea =>
            entry !== undefined && filters.categories.has(entry.area.category),
        );
      if (areas.length === 0) continue;
      if (areas.length === 1) {
        this.area(areas[0]!, parent);
        continue;
      }
      const expanded = this.state.expanded.has(group.id);
      this.add({
        id: group.id,
        parent,
        container: expanded,
        kind: 'group',
        group,
        areas: areas.map((entry) => entry.area),
        files: areas.reduce((sum, entry) => sum + entry.area.fileCount, 0),
        changed: areas.reduce(
          (sum, entry) => sum + (this.source.changedAreas.get(entry.key) ?? 0),
          0,
        ),
      });
      if (!expanded) {
        for (const entry of areas) this.areaRep.set(entry.key, group.id);
        continue;
      }
      const limit = this.state.limits.get(group.id) ?? AREA_LIMIT;
      const shown = areas.filter(
        (entry, index) => index < limit || this.state.pinned.has(entry.key),
      );
      for (const entry of shown) this.area(entry, group.id);
      const hidden = areas.filter((entry) => !shown.includes(entry));
      if (hidden.length === 0) continue;
      const id = moreId(group.id);
      this.add({
        id,
        parent: group.id,
        container: false,
        kind: 'more',
        hidden: hidden.length,
        owner: group.id,
        unit: 'area',
      });
      for (const entry of hidden) this.areaRep.set(entry.key, id);
    }
  }

  private area(entry: SceneArea, parent: string | null) {
    const expanded = this.state.expanded.has(entry.key);
    this.add({
      id: entry.key,
      parent,
      container: expanded,
      kind: 'area',
      area: entry.area,
      changed: this.source.changedAreas.get(entry.key) ?? 0,
    });
    this.areaRep.set(entry.key, entry.key);
    if (!expanded) return;
    if (!entry.complete) {
      this.add({ id: `l:${entry.key}`, parent: entry.key, container: false, kind: 'loading' });
      return;
    }
    this.open.add(entry.key);
    const { scene, filters } = this.source;
    const files = entry.files
      .filter((file) => filters.kinds.has(scene.files[file]!.kind))
      .sort((a, b) => scene.files[b]!.importance - scene.files[a]!.importance);
    const base = folderBase(entry.files.map((file) => scene.files[file]!.path));
    const byFolder = new Map<string, number[]>();
    for (const file of files) {
      const folder = folderIn(base, scene.files[file]!.path);
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), file]);
    }
    if (files.length <= FOLDERS_ABOVE || byFolder.size < 2) {
      this.files(files, entry.key);
      return;
    }
    const folders = [...byFolder].filter(([folder]) => folder !== '');
    folders.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [folder, list] of folders) {
      const id = folderId(entry.key, folder);
      const open = this.state.expanded.has(id);
      this.add({
        id,
        parent: entry.key,
        container: open,
        kind: 'folder',
        path: folder,
        files: list.length,
        changed: this.changedIn(list),
      });
      if (open) this.files(list, id);
      else for (const file of list) this.fileRep.set(file, id);
    }
    this.files(byFolder.get('') ?? [], entry.key);
  }

  private files(files: readonly number[], parent: string) {
    const { scene } = this.source;
    const limit = this.state.limits.get(parent) ?? FILE_LIMIT;
    const shown = files.filter(
      (file, index) => index < limit || this.state.pinned.has(fileNodeId(scene.files[file]!.key)),
    );
    const hidden = files.filter((file) => !shown.includes(file));
    for (const file of shown) {
      const facts = scene.files[file]!;
      const id = fileNodeId(facts.key);
      this.add({
        id,
        parent,
        container: false,
        kind: 'file',
        file,
        path: facts.path,
        name: facts.name,
        fileKind: facts.kind,
        fanIn: facts.fanIn,
        changed: this.source.changed.has(file),
      });
      this.fileRep.set(file, id);
    }
    if (hidden.length === 0) return;
    const id = moreId(parent);
    this.add({
      id,
      parent,
      container: false,
      kind: 'more',
      hidden: hidden.length,
      owner: parent,
      unit: 'file',
    });
    for (const file of hidden) this.fileRep.set(file, id);
  }

  related(a: string, b: string): boolean {
    const above = (low: string, high: string) => {
      for (
        let at = this.parentOf.get(low) ?? null;
        at !== null;
        at = this.parentOf.get(at) ?? null
      ) {
        if (at === high) return true;
      }
      return false;
    };
    return a === b || above(a, b) || above(b, a);
  }

  nodeFor(projectId: string, path: string): string | undefined {
    const { scene } = this.source;
    const file = scene.fileByKey.get(fileKey(projectId, path));
    if (file !== undefined) {
      return (
        this.fileRep.get(file) ?? this.areaRep.get(scene.areas[scene.files[file]!.areaIndex]!.key)
      );
    }
    const area = areaForPath(scene, projectId, path);
    return area ? this.areaRep.get(area) : undefined;
  }
}

function tally(
  weights: Map<string, number>,
  builder: Builder,
  source?: string,
  target?: string,
  weight = 1,
) {
  if (!source || !target || builder.related(source, target)) return;
  const key = `${source}\u0000${target}`;
  weights.set(key, (weights.get(key) ?? 0) + weight);
}

function importEdges(builder: Builder, source: TreeSource): TreeEdge[] {
  const weights = new Map<string, number>();
  for (const link of source.areaLinks) {
    if (builder.open.has(link.from) || builder.open.has(link.to)) continue;
    tally(
      weights,
      builder,
      builder.areaRep.get(link.from),
      builder.areaRep.get(link.to),
      link.weight,
    );
  }
  const seen = new Set<string>();
  for (const key of builder.open) {
    const detail = source.details.get(key);
    const projectId = key.slice(0, key.indexOf(':'));
    for (const edge of detail?.edges ?? []) {
      const id = `${projectId}\u0000${edge.from}\u0000${edge.to}`;
      if (seen.has(id)) continue;
      seen.add(id);
      tally(
        weights,
        builder,
        builder.nodeFor(projectId, edge.from),
        builder.nodeFor(projectId, edge.to),
      );
    }
  }
  return [...weights].map(([key, weight]) => {
    const [from, to] = key.split('\u0000') as [string, string];
    return { id: `e:${from}>${to}`, source: from, target: to, weight, bridge: null };
  });
}

function bridgeEdges(builder: Builder, bridges: readonly Bridge[]): TreeEdge[] {
  const byPair = new Map<string, TreeEdge>();
  for (const bridge of bridges) {
    const [fromProject, fromPath] = splitKey(bridge.from);
    const [toProject, toPath] = splitKey(bridge.to);
    const from = builder.nodeFor(fromProject, fromPath) ?? builder.areaRep.get(bridge.fromArea);
    const to = builder.nodeFor(toProject, toPath) ?? builder.areaRep.get(bridge.toArea);
    if (!from || !to || from === to) continue;
    const id = `b:${from}>${to}`;
    const edge = byPair.get(id) ?? { id, source: from, target: to, weight: 0, bridge: [] };
    edge.weight += bridge.links.length;
    if (!edge.bridge!.includes(bridge.kind)) edge.bridge!.push(bridge.kind);
    byPair.set(id, edge);
  }
  return [...byPair.values()];
}

function splitKey(key: string): [string, string] {
  const colon = key.indexOf(':');
  return [key.slice(0, colon), key.slice(colon + 1)];
}

export function buildTree(source: TreeSource, state: TreeState): TreeGraph {
  const builder = new Builder(source, state);
  const combined = source.projects.length > 1;
  for (const project of source.projects) builder.project(project.projectId, project.name, combined);
  const edges = [...importEdges(builder, source), ...bridgeEdges(builder, source.bridges)];
  return {
    items: builder.items,
    edges,
    layout: {
      nodes: builder.items.map((item) => ({
        id: item.id,
        parent: item.parent,
        container: item.container,
        ...SIZES[item.kind],
      })),
      edges: edges.map(({ source: from, target, weight }) => ({ source: from, target, weight })),
      columns: combined,
    },
  };
}

export function visibleEdges(graph: TreeGraph, level: EdgeLevel): TreeEdge[] {
  const parent = new Map(graph.items.map((item) => [item.id, item.parent ?? '']));
  const members = new Map<string, number>();
  for (const scope of parent.values()) members.set(scope, (members.get(scope) ?? 0) + 1);
  const scopes = new Map<string, TreeEdge[]>();
  const kept: TreeEdge[] = [];
  for (const edge of graph.edges) {
    if (edge.bridge) {
      kept.push(edge);
      continue;
    }
    const a = parent.get(edge.source);
    const scope = a === parent.get(edge.target) ? a! : '~';
    scopes.set(scope, [...(scopes.get(scope) ?? []), edge]);
  }
  for (const [scope, edges] of scopes) {
    const size = scope === '~' ? graph.items.length : (members.get(scope) ?? 0);
    const room = Math.max(MIN_EDGES, Math.ceil(size * EDGE_FACTOR[level]));
    kept.push(
      ...[...edges].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, room),
    );
  }
  return kept;
}

export function revealIds(
  scene: Scene,
  groups: readonly MapGroup[],
  areaKey: string,
  file?: number,
) {
  const group = groups.find((entry) => entry.areaKeys.includes(areaKey));
  const ids = [...(group ? [group.id] : []), areaKey];
  if (file === undefined) return { expand: ids, target: areaKey };
  const entry = scene.files[file]!;
  const area = scene.areas[entry.areaIndex]!;
  const base = folderBase(area.files.map((index) => scene.files[index]!.path));
  const folder = folderIn(base, entry.path);
  if (folder) ids.push(folderId(areaKey, folder));
  return { expand: ids, target: fileNodeId(entry.key) };
}
