import { MAP_CATEGORIES, type MapArea, type MapCategory } from '@spark-outpost/contracts';
import { FILE_KINDS, type FileKind } from './file-kind.ts';
import { fileKey, type Scene } from './scene.ts';

export const CATEGORY_LABELS: Record<MapCategory, string> = {
  core: 'Core',
  shared: 'Shared',
  feature: 'Feature',
};

export const CHECK_BELOW = 0.7;

export function areaForPath(scene: Scene, projectId: string, path: string): string | null {
  let best: { key: string; length: number } | null = null;
  for (const area of scene.areas) {
    if (area.projectId !== projectId) continue;
    const root = area.area.root.replace(/^\.\/?/, '').replace(/\/$/, '');
    const matches = root === '' || path === root || path.startsWith(`${root}/`);
    if (matches && (!best || root.length > best.length))
      best = { key: area.key, length: root.length };
  }
  return best?.key ?? null;
}

export interface Highlights {
  changed: Set<number>;
  dependents: Set<number>;
}

export function highlights(
  scene: Scene,
  projectId: string | null,
  paths: readonly string[],
  withDependents: boolean,
): Highlights {
  const changed = new Set<number>();
  if (!projectId) return { changed, dependents: new Set() };
  for (const path of paths) {
    const index = scene.fileByKey.get(fileKey(projectId, path));
    if (index !== undefined) changed.add(index);
  }
  const dependents = new Set<number>();
  if (withDependents) {
    for (const file of changed) {
      for (const importer of scene.ins[file]!) if (!changed.has(importer)) dependents.add(importer);
    }
  }
  return { changed, dependents };
}

export function categoryCounts(scene: Scene): Record<MapCategory, number> {
  const counts = Object.fromEntries(MAP_CATEGORIES.map((c) => [c, 0])) as Record<
    MapCategory,
    number
  >;
  for (const area of scene.areas) counts[area.area.category] += area.area.fileCount;
  return counts;
}

export function kindCounts(scene: Scene): Record<FileKind, number> | null {
  if (!scene.areas.every((area) => area.complete)) return null;
  const counts = Object.fromEntries(FILE_KINDS.map((k) => [k, 0])) as Record<FileKind, number>;
  for (const file of scene.files) counts[file.kind] += 1;
  return counts;
}

export function confidenceText(area: MapArea): string | null {
  return area.confidence === null ? null : area.confidence.toFixed(2);
}

export function needsCheck(area: MapArea): boolean {
  return area.categorySource !== 'override' && (area.confidence ?? 0) < CHECK_BELOW;
}

export function labelSource(area: MapArea): string {
  if (area.categorySource === 'override') return 'You';
  return area.categorySource === 'jev' ? 'Jev' : 'Rules';
}

export function reviewOrder(areas: readonly MapArea[]): MapArea[] {
  return [...areas].sort(
    (a, b) => (a.confidence ?? 0) - (b.confidence ?? 0) || a.name.localeCompare(b.name),
  );
}

export function kindShares(scene: Scene, areaIndex: number): [FileKind, number][] {
  const counts = new Map<FileKind, number>();
  for (const file of scene.areas[areaIndex]!.files) {
    const kind = scene.files[file]!.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return FILE_KINDS.filter((kind) => counts.has(kind)).map((kind) => [kind, counts.get(kind)!]);
}
