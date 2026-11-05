import { MAP_CATEGORIES, type MapArea, type MapCategory } from '@spark-outpost/contracts';
import { FILE_KINDS, type FileKind } from './file-kind.ts';

export interface GroupableArea {
  key: string;
  projectId: string;
  area: MapArea;
}

export interface MapGroup {
  id: string;
  projectId: string;
  path: string;
  name: string;
  pooled: boolean;
  areaKeys: string[];
  fileCount: number;
  importance: number;
  category: MapCategory;
  kindCounts: Record<FileKind, number>;
  lastChangedAt: string | null;
}

export const MAX_GROUPS = 36;
const TARGET_GROUPS = 30;
const SPLIT_PIECES = 8;
const SPLIT_AREAS = 4;
const MIN_GROUPS = 4;
const SPLIT_SHARE = 1 / 20;
const TINY_SHARE = 0.005;
const TINY_FLOOR = 3;

interface Trie {
  path: string;
  own: GroupableArea[];
  children: Map<string, Trie>;
  files: number;
}

interface Part {
  path: string;
  areas: GroupableArea[];
  trie: Trie | null;
  pooled: boolean;
  files: number;
  stuck: boolean;
}

export function areaRoot(area: MapArea): string {
  return area.root.replace(/^\.\/?/, '').replace(/\/+$/, '');
}

function buildTrie(areas: readonly GroupableArea[]): Trie {
  const root: Trie = { path: '', own: [], children: new Map(), files: 0 };
  for (const entry of areas) {
    const segments = areaRoot(entry.area).split('/').filter(Boolean);
    let node = root;
    node.files += entry.area.fileCount;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (!child) {
        child = {
          path: node.path ? `${node.path}/${segment}` : segment,
          own: [],
          children: new Map(),
          files: 0,
        };
        node.children.set(segment, child);
      }
      child.files += entry.area.fileCount;
      node = child;
    }
    node.own.push(entry);
  }
  return root;
}

function collapse(trie: Trie): Trie {
  let node = trie;
  while (node.own.length === 0 && node.children.size === 1) node = [...node.children.values()][0]!;
  return node;
}

function areasOf(trie: Trie): GroupableArea[] {
  return [...trie.own, ...[...trie.children.values()].flatMap(areasOf)];
}

function partOf(trie: Trie): Part {
  const node = collapse(trie);
  return {
    path: node.path,
    areas: areasOf(node),
    trie: node,
    pooled: false,
    files: node.files,
    stuck: false,
  };
}

function entries(trie: Trie): Part[] {
  const parts = [...trie.children.values()].map(partOf);
  for (const entry of trie.own) {
    parts.push({
      path: trie.path,
      areas: [entry],
      trie: null,
      pooled: false,
      files: entry.area.fileCount,
      stuck: false,
    });
  }
  return parts.sort((a, b) => b.files - a.files || a.path.localeCompare(b.path));
}

function pool(path: string, parts: readonly Part[]): Part[] {
  if (parts.length === 0) return [];
  if (parts.length === 1) return [parts[0]!];
  return [
    {
      path,
      areas: parts.flatMap((part) => part.areas),
      trie: null,
      pooled: true,
      files: parts.reduce((sum, part) => sum + part.files, 0),
      stuck: false,
    },
  ];
}

function split(part: Part, total: number, room: number, forced: boolean): Part[] | null {
  const pieces = entries(part.trie!);
  if (pieces.length < 2 || (!forced && pieces.length > SPLIT_PIECES)) return null;
  const tinyBelow = Math.max(TINY_FLOOR, total * TINY_SHARE);
  const large = pieces.filter((piece) => piece.files >= tinyBelow);
  let keep = large.length >= 2 ? large : pieces;
  let rest = large.length >= 2 ? pieces.filter((piece) => piece.files < tinyBelow) : [];
  if (keep.length + (rest.length > 1 ? 1 : rest.length) > room) {
    const kept = Math.max(0, room - 1);
    rest = [...keep.slice(kept), ...rest];
    keep = keep.slice(0, kept);
  }
  const result = [...keep, ...pool(part.path, rest)];
  return result.length >= 2 ? result : null;
}

function splitParts(areas: readonly GroupableArea[]): Part[] {
  const trie = buildTrie(areas);
  const total = Math.max(1, trie.files);
  const parts = [partOf(trie)];
  while (parts.length < TARGET_GROUPS) {
    const candidate = parts
      .filter(
        (part) =>
          part.trie &&
          !part.stuck &&
          (parts.length < MIN_GROUPS ||
            (part.areas.length > SPLIT_AREAS && part.files > total * SPLIT_SHARE)),
      )
      .sort((a, b) => b.files - a.files)[0];
    if (!candidate) return parts;
    const forced = parts.length < MIN_GROUPS;
    const pieces = split(candidate, total, MAX_GROUPS - (parts.length - 1), forced);
    if (!pieces) {
      candidate.stuck = true;
      continue;
    }
    parts.splice(parts.indexOf(candidate), 1, ...pieces);
  }
  return parts;
}

function dominant(areas: readonly GroupableArea[]): MapCategory {
  const files = new Map<MapCategory, number>();
  for (const { area } of areas)
    files.set(area.category, (files.get(area.category) ?? 0) + area.fileCount);
  return MAP_CATEGORIES.reduce((best, category) =>
    (files.get(category) ?? 0) > (files.get(best) ?? 0) ? category : best,
  );
}

const GENERIC = new Set(['src', 'lib', 'libs', 'source', 'app', 'apps', 'packages', 'modules']);

function shortName(path: string): string {
  const segments = path.split('/').filter(Boolean);
  while (segments.length > 1 && GENERIC.has(segments.at(-1)!)) segments.pop();
  return segments.at(-1) ?? '(root)';
}

function groupName(part: Part): string {
  if (part.pooled) return part.path ? `Other in ${shortName(part.path)}` : 'Other';
  return shortName(part.path);
}

function toGroup(projectId: string, part: Part): MapGroup {
  const areas = [...part.areas].sort(
    (a, b) => b.area.importance - a.area.importance || a.area.name.localeCompare(b.area.name),
  );
  const kindCounts = Object.fromEntries(FILE_KINDS.map((kind) => [kind, 0])) as Record<
    FileKind,
    number
  >;
  for (const { area } of areas) {
    for (const kind of FILE_KINDS) kindCounts[kind] += area.kindCounts[kind];
  }
  const changed = areas
    .map(({ area }) => area.lastChangedAt)
    .filter((at) => at !== null)
    .sort();
  return {
    id: `g:${projectId}:${part.path}${part.pooled ? ':*' : ''}`,
    projectId,
    path: part.path,
    name: groupName(part),
    pooled: part.pooled,
    areaKeys: areas.map((entry) => entry.key),
    fileCount: part.files,
    importance: areas[0]?.area.importance ?? 0,
    category: dominant(areas),
    kindCounts,
    lastChangedAt: changed.at(-1) ?? null,
  };
}

export function groupAreas(areas: readonly GroupableArea[]): MapGroup[] {
  const projects = [...new Set(areas.map((entry) => entry.projectId))];
  return projects.flatMap((projectId) =>
    splitParts(areas.filter((entry) => entry.projectId === projectId))
      .map((part) => toGroup(projectId, part))
      .sort((a, b) => b.importance - a.importance || a.path.localeCompare(b.path)),
  );
}
