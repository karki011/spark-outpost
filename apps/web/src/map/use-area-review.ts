import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MapArea, MapCategory, ProjectMap } from '@spark-outpost/contracts';
import type { ToastSpec } from '../conversations/use-toast.ts';
import { mapApi, mapKeys } from './map-api.ts';
import { CATEGORY_LABELS } from './map-model.ts';

function replaceArea(map: ProjectMap | undefined, area: MapArea): ProjectMap | undefined {
  if (!map) return map;
  return { ...map, areas: map.areas.map((entry) => (entry.id === area.id ? area : entry)) };
}

export function useAreaReview(show: (toast: ToastSpec) => void) {
  const queryClient = useQueryClient();

  const save = useCallback(
    async (projectId: string, area: MapArea, category: MapCategory | null) => {
      const key = mapKeys.project(projectId);
      const optimistic: MapArea = category
        ? { ...area, category, categorySource: 'override' }
        : { ...area, categorySource: area.confidence === null ? 'rules' : 'jev' };
      queryClient.setQueryData<ProjectMap>(key, (map) => replaceArea(map, optimistic));
      try {
        const saved = await mapApi.setCategory(projectId, area.id, category);
        queryClient.setQueryData<ProjectMap>(key, (map) => replaceArea(map, saved));
        return saved;
      } catch (error) {
        queryClient.setQueryData<ProjectMap>(key, (map) => replaceArea(map, area));
        show({ text: error instanceof Error ? error.message : 'That change was not saved.' });
        return null;
      }
    },
    [queryClient, show],
  );

  return useCallback(
    async (projectId: string, area: MapArea, category: MapCategory | null) => {
      const saved = await save(projectId, area, category);
      if (!saved) return;
      const undoTo = area.categorySource === 'override' ? area.category : null;
      show({
        text:
          category === null
            ? `${area.name} is back to ${CATEGORY_LABELS[saved.category]}`
            : `${area.name} is now ${CATEGORY_LABELS[category]}`,
        undo: () => void save(projectId, saved, undoTo),
      });
    },
    [save, show],
  );
}
