import { useMemo } from 'react';
import type { Bridge } from './bridges.ts';
import type { MapFilters } from './frame.ts';
import type { MapGroup } from './groups.ts';
import { areaForPath } from './map-model.ts';
import type { TreeSource } from './tree/tree-model.ts';
import type { ChatChanges } from './use-chat-changes.ts';
import type { useMapData } from './use-map-data.ts';

interface ViewSourceInput {
  data: ReturnType<typeof useMapData>;
  groups: readonly MapGroup[];
  filters: MapFilters;
  changed: ReadonlySet<number>;
  changes: ChatChanges | null;
  combined: boolean;
}

function callersFirst(
  projects: readonly { id: string; name: string }[],
  bridges: readonly Pick<Bridge, 'from' | 'to'>[],
) {
  const calls = new Map<string, number>();
  const projectOf = (key: string) => key.slice(0, key.indexOf(':'));
  for (const bridge of bridges) {
    calls.set(projectOf(bridge.from), (calls.get(projectOf(bridge.from)) ?? 0) + 1);
    calls.set(projectOf(bridge.to), (calls.get(projectOf(bridge.to)) ?? 0) - 1);
  }
  return [...projects]
    .sort((a, b) => (calls.get(b.id) ?? 0) - (calls.get(a.id) ?? 0))
    .map((project) => ({ projectId: project.id, name: project.name }));
}

export function useViewSource({
  data,
  groups,
  filters,
  changed,
  changes,
  combined,
}: ViewSourceInput): TreeSource {
  const { scene, maps, details, bridges, projects } = data;
  const changedProject = changes?.projectId ?? null;
  const changedPaths = changes?.paths;
  const changedAreas = useMemo(() => {
    const counts = new Map<string, number>();
    if (!changedProject || !changedPaths) return counts;
    for (const path of changedPaths) {
      const key = areaForPath(scene, changedProject, path);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [scene, changedProject, changedPaths]);
  const areaLinks = useMemo(
    () =>
      maps.flatMap((map) =>
        map.areaEdges.map((edge) => ({
          from: `${map.projectId}:${edge.from}`,
          to: `${map.projectId}:${edge.to}`,
          weight: edge.weight,
        })),
      ),
    [maps],
  );
  const ordered = useMemo(() => callersFirst(projects, bridges), [projects, bridges]);
  return useMemo(
    () => ({
      scene,
      groups,
      areaLinks,
      details,
      filters,
      changed,
      changedAreas,
      bridges: combined ? bridges.filter((bridge) => filters.links.has(bridge.kind)) : [],
      projects: ordered,
    }),
    [scene, groups, areaLinks, details, filters, changed, changedAreas, combined, bridges, ordered],
  );
}
