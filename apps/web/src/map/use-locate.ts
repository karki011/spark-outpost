import { useEffect } from 'react';
import { areaForPath } from './map-model.ts';
import { fileKey, type Scene } from './scene.ts';

export interface Wanted {
  projectId: string;
  paths: readonly string[];
}

export type LocateState = 'found' | 'looking' | 'missing';

interface Step {
  state: LocateState;
  load: string[];
}

function incomplete(scene: Scene, keys: readonly string[]): string[] {
  return keys.filter((key) => {
    const index = scene.areaByKey.get(key);
    return index !== undefined && !scene.areas[index]!.complete;
  });
}

export function locateStep(scene: Scene, wanted: Wanted): Step {
  const missing = wanted.paths.filter(
    (path) => !scene.fileByKey.has(fileKey(wanted.projectId, path)),
  );
  if (missing.length === 0) return { state: 'found', load: [] };
  const best = new Set<string>();
  for (const path of missing) {
    const key = areaForPath(scene, wanted.projectId, path);
    if (key) best.add(key);
  }
  const first = incomplete(scene, [...best]);
  if (first.length > 0) return { state: 'looking', load: first };
  const all = scene.areas
    .filter((area) => area.projectId === wanted.projectId)
    .map((area) => area.key);
  const rest = incomplete(scene, all);
  return rest.length > 0 ? { state: 'looking', load: rest } : { state: 'missing', load: [] };
}

export function useLocate(
  scene: Scene,
  wanted: Wanted | null,
  require: (keys: readonly string[]) => void,
): LocateState | null {
  const step = wanted ? locateStep(scene, wanted) : null;
  const loadKey = step?.load.join(',') ?? '';
  useEffect(() => {
    if (loadKey) require(loadKey.split(','));
  }, [loadKey, require]);
  return step?.state ?? null;
}
