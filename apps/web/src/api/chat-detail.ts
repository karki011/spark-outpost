import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './client.ts';

export function invalidateChatDetail(client: QueryClient, conversationId: string): Promise<void> {
  return client.invalidateQueries({
    queryKey: queryKeys.conversation(conversationId),
    exact: true,
  });
}
