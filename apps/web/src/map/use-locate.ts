import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mapApi, mapKeys } from './map-api.ts';
import { areaKey, fileKey, type Scene } from './scene.ts';

export interface Wanted {
  projectId: string;
  paths: readonly string[];
}

export type LocateState = 'found' | 'looking' | 'missing';

interface Step {
  state: LocateState;
  load: string[];
}

export type Located = ReadonlyMap<string, string | null>;

export function locateStep(scene: Scene, wanted: Wanted, located: Located | undefined): Step {
  const missing = wanted.paths.filter(
    (path) => !scene.fileByKey.has(fileKey(wanted.projectId, path)),
  );
  if (missing.length === 0) return { state: 'found', load: [] };
  if (!located) return { state: 'looking', load: [] };
  const keys = new Set<string>();
  for (const path of missing) {
    const areaId = located.get(path);
    if (areaId) keys.add(areaKey(wanted.projectId, areaId));
  }
  const load = [...keys].filter((key) => {
    const index = scene.areaByKey.get(key);
    return index !== undefined && !scene.areas[index]!.complete;
  });
  return load.length > 0 ? { state: 'looking', load } : { state: 'missing', load: [] };
}

export function useLocate(
  scene: Scene,
  wanted: Wanted | null,
  require: (keys: readonly string[]) => void,
): LocateState | null {
  const pathsKey = wanted?.paths.join('\n') ?? '';
  const paths = useMemo(() => (pathsKey ? pathsKey.split('\n') : []), [pathsKey]);
  const projectId = wanted?.projectId ?? '';
  const absent =
    wanted !== null && paths.some((path) => !scene.fileByKey.has(fileKey(projectId, path)));
  const query = useQuery({
    queryKey: mapKeys.locate(projectId, paths),
    queryFn: () => mapApi.locate(projectId, paths),
    enabled: absent,
    gcTime: 0,
    retry: false,
  });
  const located = useMemo<Located | undefined>(() => {
    if (query.data) return new Map(query.data.located.map((row) => [row.path, row.areaId]));
    return query.isError ? new Map() : undefined;
  }, [query.data, query.isError]);
  const step = wanted ? locateStep(scene, wanted, located) : null;
  const loadKey = step?.load.join(',') ?? '';
  useEffect(() => {
    if (loadKey) require(loadKey.split(','));
  }, [loadKey, require]);
  return step?.state ?? null;
}
