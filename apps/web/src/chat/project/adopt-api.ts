import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  adoptPullResultSchema,
  openPullsSchema,
  type AdoptPullResult,
  type OpenPulls,
} from '@spark-outpost/contracts';
import { request } from '../../api/client.ts';
import { prWatchesKey } from '../pull-request/pr-follow-up-api.ts';
import { workspaceKeys } from './use-chat-workspace.ts';

export const adoptKeys = {
  open: (projectId: string) => ['projects', projectId, 'pull-requests', 'open'] as const,
};

export const adoptApi = {
  open: (projectId: string): Promise<OpenPulls> =>
    request(openPullsSchema, `/projects/${projectId}/pull-requests/open`),
  adopt: (
    conversationId: string,
    body: { projectId: string; number: number; url?: string },
  ): Promise<AdoptPullResult> =>
    request(adoptPullResultSchema, `/conversations/${conversationId}/workspace/adopt`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export function useAdoptPull(conversationId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pull: { number: number; url?: string }) =>
      adoptApi.adopt(conversationId, { projectId, ...pull }),
    onSuccess: async (result) => {
      queryClient.setQueryData(workspaceKeys.chat(conversationId), result.workspace);
      await queryClient.invalidateQueries({ queryKey: prWatchesKey(conversationId) });
    },
  });
}
