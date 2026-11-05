import { createHash } from 'node:crypto';
import type { WorkspacePackage } from '../codescan/layout.ts';
import { AREA_MAX_DEPTH, AREA_MIN_FILES, AREA_SPLIT_AT } from './policy.ts';

export type AreaSource = 'package' | 'folder' | 'merged' | 'root';

export interface Area {
  id: string;
  root: string;
  source: AreaSource;
  package: string;
  reason: string;
  files: string[];
}

interface Unit {
  root: string;
  source: AreaSource;
  package: string;
  top: string;
  depth: number;
  files: string[];
  reason: string;
}

export const ROOT_AREA = '(root)';

export function areaId(root: string): string {
  return createHash('sha1').update(root).digest('hex').slice(0, 12);
}

function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '.' : path.slice(0, cut);
}

function packageRootOf(roots: ReadonlySet<string>, path: string): string | null {
  for (let dir = directoryOf(path); ; dir = directoryOf(dir)) {
    if (dir !== '.' && roots.has(dir)) return dir;
    if (dir === '.') return null;
  }
}

function topUnits(paths: readonly string[], packages: readonly WorkspacePackage[]): Unit[] {
  const names = new Map(packages.map((entry) => [entry.root, entry.name]));
  const roots = new Set(names.keys());
  const units = new Map<string, Unit>();
  for (const path of paths) {
    const packageRoot = packageRootOf(roots, path);
    const slash = path.indexOf('/');
    const root = packageRoot ?? (slash === -1 ? ROOT_AREA : path.slice(0, slash));
    let unit = units.get(root);
    if (!unit) {
      const source: AreaSource = packageRoot ? 'package' : root === ROOT_AREA ? 'root' : 'folder';
      const name = packageRoot ? (names.get(packageRoot) ?? root) : (names.get('.') ?? '.');
      const reason =
        source === 'package'
          ? `workspace package ${name}`
          : source === 'root'
            ? 'files at the repository root'
            : `top-level folder ${root}`;
      unit = { root, source, package: name, top: root, depth: 0, files: [], reason };
      units.set(root, unit);
    }
    unit.files.push(path);
  }
  return [...units.values()];
}

function childKey(unit: Unit, path: string): string {
  if (unit.source === 'root') return unit.root;
  const rest = path.slice(unit.root.length + 1);
  const slash = rest.indexOf('/');
  return slash === -1 ? unit.root : `${unit.root}/${rest.slice(0, slash)}`;
}

function split(unit: Unit): Unit[] {
  if (unit.files.length <= AREA_SPLIT_AT || unit.depth >= AREA_MAX_DEPTH) return [unit];
  const children = new Map<string, string[]>();
  for (const path of unit.files) {
    const key = childKey(unit, path);
    const list = children.get(key) ?? [];
    list.push(path);
    children.set(key, list);
  }
  if (children.size === 1 && children.has(unit.root)) return [unit];
  return [...children].flatMap(([root, files]) => {
    const own = root === unit.root;
    const child: Unit = {
      ...unit,
      root,
      source: own ? unit.source : 'folder',
      depth: own ? unit.depth : unit.depth + 1,
      files,
      reason: own
        ? unit.reason
        : `folder ${root}, split from ${unit.root} (${unit.files.length} files)`,
    };
    return own ? [child] : split(child);
  });
}

function edgeCounts(units: readonly Unit[], edges: readonly (readonly [string, string])[]) {
  const unitOf = new Map<string, number>();
  units.forEach((unit, index) => {
    for (const path of unit.files) unitOf.set(path, index);
  });
  const counts = new Map<string, number>();
  for (const [from, to] of edges) {
    const a = unitOf.get(from);
    const b = unitOf.get(to);
    if (a === undefined || b === undefined || a === b) continue;
    for (const key of [`${a}:${b}`, `${b}:${a}`]) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function commonPrefix(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  let shared = 0;
  while (shared < left.length && left[shared] === right[shared]) shared += 1;
  return shared;
}

interface Candidate {
  index: number;
  edges: number;
  prefix: number;
  root: string;
}

function preferred(candidate: Candidate, best: Candidate | null): boolean {
  if (!best) return true;
  if (candidate.edges !== best.edges) return candidate.edges > best.edges;
  if (candidate.prefix !== best.prefix) return candidate.prefix > best.prefix;
  return candidate.root < best.root;
}

function mergeTarget(
  small: number,
  units: readonly Unit[],
  counts: ReadonlyMap<string, number>,
): Candidate | null {
  const unit = units[small] as Unit;
  let best: Candidate | null = null;
  for (const [index, other] of units.entries()) {
    if (index === small || other.top !== unit.top || other.files.length < AREA_MIN_FILES) continue;
    const candidate = {
      index,
      edges: counts.get(`${small}:${index}`) ?? 0,
      prefix: commonPrefix(unit.root, other.root),
      root: other.root,
    };
    if (preferred(candidate, best)) best = candidate;
  }
  return best;
}

function mergeSmall(units: Unit[], edges: readonly (readonly [string, string])[]): Unit[] {
  const counts = edgeCounts(units, edges);
  const merged = units.map((unit) => ({ ...unit, files: [...unit.files] }));
  const absorbed = new Set<number>();
  units.forEach((unit, index) => {
    if (unit.depth === 0 || unit.files.length >= AREA_MIN_FILES) return;
    const target = mergeTarget(index, units, counts);
    if (!target) return;
    const into = merged[target.index] as Unit;
    into.files.push(...unit.files);
    const why = target.edges > 0 ? `${target.edges} import links` : 'nearest folder';
    into.reason = `${into.reason}; merged ${unit.root} (${unit.files.length} files, ${why})`;
    if (into.source !== 'package' && into.source !== 'root') into.source = 'merged';
    absorbed.add(index);
  });
  return merged.filter((_, index) => !absorbed.has(index));
}

export function buildAreas(
  paths: readonly string[],
  packages: readonly WorkspacePackage[],
  edges: readonly (readonly [string, string])[],
): Area[] {
  const sorted = [...paths].sort();
  const units = mergeSmall(topUnits(sorted, packages).flatMap(split), edges);
  return units
    .map((unit) => ({
      id: areaId(unit.root),
      root: unit.root,
      source: unit.source,
      package: unit.package,
      reason: unit.reason,
      files: unit.files.sort(),
    }))
    .sort((a, b) => a.root.localeCompare(b.root));
}
