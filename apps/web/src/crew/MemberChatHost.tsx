import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { closeMemberChat, useMemberChat } from './member-chat-store.ts';
import { findMember, messagesFor } from './member-model.ts';
import { MemberChat } from './MemberChat.tsx';

export function MemberChatHost() {
  const target = useMemberChat();
  const detail = useQuery({
    queryKey: queryKeys.conversation(target?.conversationId ?? ''),
    queryFn: () => api.getConversation(target!.conversationId),
    enabled: target !== null,
  });
  if (!target) return null;
  const found = findMember(detail.data, target.runId);
  if (!found) return null;
  return (
    <MemberChat
      key={target.runId}
      conversationId={target.conversationId}
      agent={found.agent}
      messages={messagesFor(detail.data, target.runId)}
      onClose={closeMemberChat}
    />
  );
}
