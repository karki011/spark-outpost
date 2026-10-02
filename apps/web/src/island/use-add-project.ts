import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';

export function useAddProject(onAdded: (project: Project) => void) {
  const queryClient = useQueryClient();
  const [browsing, setBrowsing] = useState(false);
  const link = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(projectKeys.all, (list) =>
        list && !list.some((item) => item.id === project.id) ? [...list, project] : list,
      );
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      setBrowsing(false);
      onAdded(project);
    },
  });
  const start = async () => {
    link.reset();
    const desktop = sparkDesktop();
    if (!desktop) {
      setBrowsing(true);
      return;
    }
    const folder = await desktop.island.pickFolder();
    if (folder) link.mutate(folder);
  };
  return {
    start,
    linkFolder: (folder: string) => link.mutate(folder),
    adding: link.isPending,
    error: link.isError ? link.error.message : null,
    browsing,
    close: () => setBrowsing(false),
  };
}
