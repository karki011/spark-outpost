import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subChatsResponseSchema, type SubChatsResponse } from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const subChatKeys = {
  all: ['sub-chats'] as const,
  of: (conversationId: string) => ['sub-chats', conversationId] as const,
};

const subChatsApi = {
  list: (conversationId: string): Promise<SubChatsResponse> =>
    request(subChatsResponseSchema, `/conversations/${conversationId}/sub-chats`),
  start: (conversationId: string, subChatId: string): Promise<SubChatsResponse> =>
    request(
      subChatsResponseSchema,
      `/conversations/${conversationId}/sub-chats/${subChatId}/start`,
      { method: 'POST', body: '{}' },
    ),
};

export function useSubChats(parentId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: subChatKeys.of(parentId ?? ''),
    queryFn: () => subChatsApi.list(parentId!),
    enabled: enabled && Boolean(parentId),
    select: (response) => response.subChats,
  });
}

export function useStartAnyway(parentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (subChatId: string) => subChatsApi.start(parentId, subChatId),
    onSuccess: (response) => client.setQueryData(subChatKeys.of(parentId), response),
  });
}
