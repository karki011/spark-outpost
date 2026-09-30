import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { Project, ProjectMap } from '@spark-outpost/contracts';
import { aggregateBridges } from './bridges.ts';
import { AreaLoader, type LoadedArea } from './area-loader.ts';
import type { LoadCandidate } from './lod.ts';
import { mapApi, mapKeys } from './map-api.ts';
import { buildScene, type ProjectInput } from './scene.ts';

const BUILDING_POLL_MS = 3000;

function isBuilding(map: ProjectMap | undefined): boolean {
  const status = map?.status?.status;
  return status === undefined || status === 'queued' || status === 'building';
}

function splitKey(key: string): [string, string] {
  const colon = key.indexOf(':');
  return [key.slice(0, colon), key.slice(colon + 1)];
}

function useAreaLoader(maps: readonly ProjectMap[]) {
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedArea>>(new Map());
  const [loader] = useState(
    () =>
      new AreaLoader(
        (key, limit, version) => {
          const [projectId, areaId] = splitKey(key);
          return queryClient.fetchQuery({
            queryKey: mapKeys.area(projectId, areaId, limit, version),
            queryFn: () => mapApi.area(projectId, areaId, limit),
            staleTime: Infinity,
          });
        },
        (batch) => setLoaded((previous) => new Map([...previous, ...batch])),
      ),
  );
  const versions = useMemo(
    () => new Map(maps.map((map) => [map.projectId, map.status?.builtAt ?? ''])),
    [maps],
  );
  useEffect(() => loader.sync(versions), [loader, versions]);
  useEffect(() => () => loader.stop(), [loader]);
  const details = useMemo(
    () =>
      new Map(
        [...loaded]
          .filter(([key, entry]) => versions.get(splitKey(key)[0]) === entry.version)
          .map(([key, entry]) => [key, entry.detail]),
      ),
    [loaded, versions],
  );
  const want = useCallback(
    (candidates: readonly LoadCandidate[]) => loader.want(candidates),
    [loader],
  );
  const require = useCallback((keys: readonly string[]) => loader.require(keys), [loader]);
  return { details, want, require };
}

function combineMaps(results: readonly UseQueryResult<ProjectMap>[]) {
  return {
    maps: results.map((result) => result.data).filter((map) => map !== undefined),
    pending: results.some((result) => result.isPending),
    error: results.find((result) => result.isError)?.error ?? null,
  };
}

export function useMapData(projects: readonly Project[], selected: readonly string[]) {
  const chosen = useMemo(
    () =>
      selected
        .map((id) => projects.find((project) => project.id === id))
        .filter((p) => p !== undefined),
    [projects, selected],
  );
  const { maps, pending, error } = useQueries({
    queries: chosen.map((project) => ({
      queryKey: mapKeys.project(project.id),
      queryFn: () => mapApi.project(project.id),
      refetchInterval: (query: { state: { data: ProjectMap | undefined } }) =>
        isBuilding(query.state.data) ? BUILDING_POLL_MS : false,
    })),
    combine: combineMaps,
  });
  const loader = useAreaLoader(maps);
  const inputs = useMemo<ProjectInput[]>(
    () =>
      maps.map((map) => ({
        projectId: map.projectId,
        name: chosen.find((project) => project.id === map.projectId)?.name ?? 'Project',
        map,
      })),
    [maps, chosen],
  );
  const scene = useMemo(() => buildScene(inputs, loader.details), [inputs, loader.details]);
  const ids = chosen.map((project) => project.id);
  const combined = ids.length > 1;
  const links = useQuery({
    queryKey: mapKeys.links(ids),
    queryFn: () => mapApi.links(ids),
    enabled: combined,
  });
  const unmatched = useQuery({
    queryKey: mapKeys.unmatched(ids),
    queryFn: () => mapApi.unmatched(ids),
    enabled: combined,
    retry: false,
  });
  const bridges = useMemo(() => aggregateBridges(links.data?.links ?? []), [links.data]);
  return {
    projects: chosen,
    maps,
    pending,
    error,
    scene,
    bridges,
    unmatched: combined ? (unmatched.data ?? null) : null,
    ...loader,
  };
}
