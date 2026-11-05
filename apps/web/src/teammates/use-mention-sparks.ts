import { useQuery } from '@tanstack/react-query';
import type { ConversationDetail, TeammateView } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { useTeammates } from './use-teammates.ts';

const chatSparkId = (detail: ConversationDetail) => detail.conversation.teammate?.id ?? null;

export function useMentionSparks(conversationId: string): TeammateView[] {
  const { teammates } = useTeammates();
  const own = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
    select: chatSparkId,
  });
  if (!own.data) return teammates;
  return teammates.filter((teammate) => teammate.id !== own.data);
}

const PICKER_LIMIT = 6;

export function sparksMatching<T extends { name: string }>(
  sparks: readonly T[],
  query: string,
): T[] {
  const wanted = query.toLowerCase();
  const startsWord = (name: string) =>
    name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(wanted));
  return sparks.filter((spark) => startsWord(spark.name)).slice(0, PICKER_LIMIT);
}
