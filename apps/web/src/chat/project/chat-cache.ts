import { useQuery } from '@tanstack/react-query';
import type { ConversationDetail, PromptCacheLast } from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { activeRun } from '../turns.ts';

export function chatIdle(detail: ConversationDetail): boolean {
  if (activeRun(detail)) return false;
  if ((detail.conversation.latestRun?.waitingOn ?? 0) > 0) return false;
  return !detail.approvals.some((approval) => approval.status === 'pending');
}

export function useIdleCache(conversationId: string): PromptCacheLast | null {
  const detail = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
  }).data;
  if (!detail || !chatIdle(detail)) return null;
  return detail.promptCache?.last ?? null;
}
