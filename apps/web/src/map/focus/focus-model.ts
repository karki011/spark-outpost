import type { MapArea, MapNeighbor, MapNeighbors } from '@spark-outpost/contracts';
import { areaKey, type Scene } from '../scene.ts';

export interface NeighborGroup {
  key: string;
  area: MapArea | null;
  files: MapNeighbor[];
}

const RANK = { core: 0, shared: 1, feature: 2 } as const;

export function byArea(
  scene: Scene,
  projectId: string,
  files: readonly MapNeighbor[],
): NeighborGroup[] {
  const groups = new Map<string, NeighborGroup>();
  for (const file of files) {
    const key = areaKey(projectId, file.areaId);
    const group = groups.get(key) ?? {
      key,
      area: scene.areas[scene.areaByKey.get(key) ?? -1]?.area ?? null,
      files: [],
    };
    group.files.push(file);
    groups.set(key, group);
  }
  const rank = (group: NeighborGroup) => (group.area ? RANK[group.area.category] : 3);
  const top = (group: NeighborGroup) => Math.max(...group.files.map((file) => file.importance));
  return [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || top(b) - top(a) || a.key.localeCompare(b.key),
  );
}

const plural = (count: number, word: string) =>
  `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

export interface ImpactSummary {
  headline: string;
  detail: string | null;
  core: string | null;
}

export function impactSummary(neighbors: MapNeighbors): ImpactSummary {
  const { direct, total, areas, coreAreas } = neighbors.impact;
  if (total === 0) {
    return { headline: 'Nothing on the map depends on this file.', detail: null, core: null };
  }
  const verb = total === 1 ? 'depends' : 'depend';
  return {
    headline: `${plural(total, 'file')} ${verb} on this, directly or through imports.`,
    detail: `${plural(direct, 'file')} import it directly · across ${plural(areas, 'area')}`,
    core:
      coreAreas.length === 0
        ? null
        : `Core areas affected: ${coreAreas.map((area) => `${area.name} (${area.files})`).join(', ')}`,
  };
}
