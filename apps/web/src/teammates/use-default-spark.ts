import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { invalidateChatDetail } from '../api/chat-detail.ts';
import { api, queryKeys } from '../api/client.ts';
import { teammatesApi } from './teammates-api.ts';
import { useTeammates } from './use-teammates.ts';

const offered = new Set<string>();

const untouched = (detail: ConversationDetail) =>
  detail.messages.length === 0 && !detail.conversation.teammate;

export function useDefaultSpark(conversationId: string): void {
  const client = useQueryClient();
  const { defaultTeammateId } = useTeammates();
  const chat = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => api.getConversation(conversationId),
    select: untouched,
  });
  const wanted = defaultTeammateId !== null && chat.data === true;
  useEffect(() => {
    if (!wanted || offered.has(conversationId)) return;
    offered.add(conversationId);
    void teammatesApi.startWithDefault(conversationId).then(
      (linked) => {
        if (!linked.teammate) return;
        void invalidateChatDetail(client, conversationId);
        void client.invalidateQueries({ queryKey: queryKeys.agentCommands(conversationId) });
      },
      () => {
        offered.delete(conversationId);
      },
    );
  }, [client, conversationId, wanted]);
}
