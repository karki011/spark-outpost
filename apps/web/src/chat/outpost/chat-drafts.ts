import { chatDraftsSchema, type ChatDrafts } from '@spark-outpost/contracts';
import { queryKeys, request } from '../../api/client.ts';

const CHAT_DRAFTS = 'outpost-drafts';

export function isChatDraftsKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === queryKeys.conversations[0] && queryKey.at(-1) === CHAT_DRAFTS;
}

export const chatDraftsQuery = (conversationId: string) => ({
  queryKey: [...queryKeys.conversation(conversationId), CHAT_DRAFTS] as const,
  queryFn: (): Promise<ChatDrafts> =>
    request(chatDraftsSchema, `/conversations/${conversationId}/outpost-drafts`),
});
