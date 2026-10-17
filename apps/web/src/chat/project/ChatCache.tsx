import { useQuery } from '@tanstack/react-query';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { CacheTimer } from '../../usage/CacheTimer.tsx';
import { activeRun } from '../turns.ts';

export function chatIdle(detail: ConversationDetail): boolean {
  if (activeRun(detail)) return false;
  if ((detail.conversation.latestRun?.waitingOn ?? 0) > 0) return false;
  return !detail.approvals.some((approval) => approval.status === 'pending');
}

export function ChatCache({ conversationId }: { conversationId: string }) {
  const detail = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
  }).data;
  const last = detail?.promptCache?.last ?? null;
  return <CacheTimer last={last} idle={detail ? chatIdle(detail) : false} />;
}
