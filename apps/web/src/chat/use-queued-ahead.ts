import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';

export function useQueuedAhead(conversationId: string, runId: string): number | undefined {
  const { data } = useQuery({ queryKey: queryKeys.conversations, queryFn: api.listConversations });
  const latest = data?.find((chat) => chat.id === conversationId)?.latestRun;
  return latest?.id === runId ? latest.ahead : undefined;
}
