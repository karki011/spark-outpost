import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail, Project } from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { projectKeys, projectsApi } from '../../api/projects.ts';
import { applyRepoChange, type RepoChange } from './repo-list.ts';

const GIT_STALE_MS = 30_000;

export type RepoRequest = RepoChange | { type: 'add'; rootPath: string };

export function useProjects() {
  return useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
}

export function useLinkedProjects(projectIds: readonly string[]): Project[] {
  const projects = useProjects();
  return useMemo(() => {
    const byId = new Map((projects.data ?? []).map((project) => [project.id, project]));
    return projectIds.flatMap((id) => byId.get(id) ?? []);
  }, [projects.data, projectIds]);
}

export function useProjectBranch(projectId: string | null): string | null {
  const git = useQuery({
    queryKey: projectKeys.git(projectId ?? ''),
    queryFn: () => projectsApi.git(projectId ?? ''),
    enabled: projectId !== null,
    staleTime: GIT_STALE_MS,
  });
  return projectId ? (git.data?.branch ?? null) : null;
}

async function resolveChange(request: RepoRequest): Promise<RepoChange> {
  if (request.type !== 'add' || !('rootPath' in request)) return request;
  const project = await projectsApi.create(request.rootPath);
  return { type: 'add', projectId: project.id };
}

export function useChatRepos(conversationId: string) {
  const queryClient = useQueryClient();
  const detailKey = queryKeys.conversation(conversationId);
  return useMutation({
    mutationFn: async (request: RepoRequest) => {
      const change = await resolveChange(request);
      const current =
        queryClient.getQueryData<ConversationDetail>(detailKey)?.conversation.projectIds ?? [];
      const projectIds = applyRepoChange(current, change);
      await api.updateChatSettings(conversationId, { projectIds });
      return projectIds;
    },
    onSuccess: async (projectIds) => {
      queryClient.setQueryData<ConversationDetail>(detailKey, (detail) =>
        detail ? { ...detail, conversation: { ...detail.conversation, projectIds } } : detail,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
        queryClient.invalidateQueries({ queryKey: detailKey }),
      ]);
    },
  });
}
