import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ConversationSummary, Project, RemovedProject } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import type { Toaster } from './use-toast.ts';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function patchProjects(client: QueryClient, change: (list: Project[]) => Project[]): void {
  client.setQueryData<Project[]>(projectKeys.all, (list) => (list ? change(list) : list));
}

function unlinkChats(client: QueryClient, projectId: string): void {
  client.setQueryData<ConversationSummary[]>(queryKeys.conversations, (list) =>
    list?.map((chat) =>
      chat.projectIds.includes(projectId)
        ? { ...chat, projectIds: chat.projectIds.filter((id) => id !== projectId) }
        : chat,
    ),
  );
}

async function refresh(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: projectKeys.all }),
    client.invalidateQueries({ queryKey: queryKeys.conversations }),
    client.invalidateQueries({ queryKey: ['conversation-search'] }),
  ]);
}

export function useProjectActions(toaster: Toaster, onRestored: (projectId: string) => void) {
  const client = useQueryClient();

  const rename = async (project: Project, name: string) => {
    patchProjects(client, (list) =>
      list.map((entry) => (entry.id === project.id ? { ...entry, name } : entry)),
    );
    try {
      await projectsApi.rename(project.id, name);
    } catch (error) {
      toaster.show({ text: message(error) });
    }
    await client.invalidateQueries({ queryKey: projectKeys.all });
  };

  const restore = async (removed: RemovedProject) => {
    try {
      const project = await projectsApi.restore(removed);
      onRestored(project.id);
      toaster.show({ text: `Restored ${project.name}` });
    } catch (error) {
      toaster.show({ text: message(error) });
    }
    await refresh(client);
  };

  const remove = async (project: Project) => {
    try {
      const removed = await projectsApi.remove(project.id);
      patchProjects(client, (list) => list.filter((entry) => entry.id !== project.id));
      unlinkChats(client, project.id);
      toaster.show({
        text: `Removed ${project.name}. Its chats moved to Chats.`,
        undo: () => void restore(removed),
      });
    } catch (error) {
      toaster.show({ text: message(error) });
    }
    await refresh(client);
  };

  return {
    rename: (project: Project, name: string) => void rename(project, name),
    remove: (project: Project) => void remove(project),
  };
}
