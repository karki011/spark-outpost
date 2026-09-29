import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bringChangesResultSchema,
  chatWorkspaceSchema,
  projectBranchesSchema,
  type BringChangesResult,
  type ChatWorkspace,
  type ProjectBranches,
  type UpdateChatWorkspaceRequest,
} from '@spark-outpost/contracts';
import { queryKeys, request } from '../../api/client.ts';

export const workspaceKeys = {
  chat: (conversationId: string) => ['conversations', conversationId, 'workspace'] as const,
  branches: (projectId: string) => ['project-branches', projectId] as const,
};

export const workspaceApi = {
  get: (conversationId: string): Promise<ChatWorkspace> =>
    request(chatWorkspaceSchema, `/conversations/${conversationId}/workspace`),
  update: (conversationId: string, body: UpdateChatWorkspaceRequest): Promise<ChatWorkspace> =>
    request(chatWorkspaceSchema, `/conversations/${conversationId}/workspace`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  open: (conversationId: string): Promise<null> =>
    request(z.null(), `/conversations/${conversationId}/workspace/open`, {
      method: 'POST',
      body: '{}',
    }),
  bring: (conversationId: string): Promise<BringChangesResult> =>
    request(bringChangesResultSchema, `/conversations/${conversationId}/workspace/bring`, {
      method: 'POST',
      body: '{}',
    }),
  branches: (projectId: string, fetch = false): Promise<ProjectBranches> =>
    request(projectBranchesSchema, `/projects/${projectId}/branches${fetch ? '?fetch=1' : ''}`),
};

export function useChatWorkspace(conversationId: string, enabled = true) {
  return useQuery({
    queryKey: workspaceKeys.chat(conversationId),
    queryFn: () => workspaceApi.get(conversationId),
    enabled,
  });
}

export function useProjectBranches(projectId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: workspaceKeys.branches(projectId ?? ''),
    queryFn: () => workspaceApi.branches(projectId ?? ''),
    enabled: enabled && projectId !== null,
  });
}

export function useFetchBranches(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => workspaceApi.branches(projectId ?? '', true),
    onSuccess: (branches) => {
      queryClient.setQueryData(workspaceKeys.branches(projectId ?? ''), branches);
    },
  });
}

export function useUpdateWorkspace(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateChatWorkspaceRequest) => workspaceApi.update(conversationId, body),
    onSuccess: (workspace) => {
      queryClient.setQueryData(workspaceKeys.chat(conversationId), workspace);
    },
  });
}

export function useOpenWorktree(conversationId: string) {
  return useMutation({ mutationFn: () => workspaceApi.open(conversationId) });
}

export function useBringChanges(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => workspaceApi.bring(conversationId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
  });
}
