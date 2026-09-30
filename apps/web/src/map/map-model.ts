import {
  MAP_CATEGORIES,
  type CoreImpact,
  type MapArea,
  type MapCategory,
} from '@spark-outpost/contracts';
import { baseName, FILE_KINDS, type FileKind } from './file-kind.ts';
import { fileKey, type Scene, type SceneFile } from './scene.ts';

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
  if (scene.areas.length === 0) return null;
  const counts = Object.fromEntries(FILE_KINDS.map((k) => [k, 0])) as Record<FileKind, number>;
  for (const { area } of scene.areas) {
    for (const kind of FILE_KINDS) counts[kind] += area.kindCounts[kind];
  }
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
  const counts = scene.areas[areaIndex]!.area.kindCounts;
  return FILE_KINDS.filter((kind) => counts[kind] > 0).map((kind) => [kind, counts[kind]]);
}

const DAY_MS = 86_400_000;
const RECENT_DAYS = 14;

export function changedAgo(iso: string, now: number): string {
  const startOfDay = (time: number) => {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso).getTime())) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < RECENT_DAYS) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const HISTORY_REASON = /^(imported by|changed \d+ times|\d+ authors)/;

export function fileFacts(
  file: Pick<SceneFile, 'lastChangedAt' | 'changeCount' | 'authorCount' | 'reasons' | 'lines'>,
  now: number,
): string {
  if (file.lastChangedAt) {
    return [
      `Changed ${changedAgo(file.lastChangedAt, now)}`,
      plural(file.changeCount, 'commit'),
      plural(file.authorCount, 'author'),
    ].join(' · ');
  }
  const facts = file.reasons.filter((reason) => !HISTORY_REASON.test(reason));
  return [...facts, `${file.lines.toLocaleString('en-US')} lines`].join(' · ');
}

const CORE_NAMES_SHOWN = 3;

export function coreImpactText(impact: CoreImpact): string {
  const names = impact.areas.map((area) => area.name);
  const hidden = names.length - CORE_NAMES_SHOWN;
  const shown = hidden > 0 ? [...names.slice(0, CORE_NAMES_SHOWN), `${hidden} more`] : names;
  const keys = impact.keyFiles.length;
  if (shown.length === 0) return `Touches key files: ${impact.keyFiles.map(baseName).join(', ')}`;
  const core = `Touches Core: ${shown.join(', ')}`;
  return keys > 0 ? `${core} · ${plural(keys, 'key file')}` : core;
}
