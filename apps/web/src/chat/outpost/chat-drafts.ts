import { chatDraftsSchema, type ChatDrafts } from '@spark-outpost/contracts';
import { queryKeys, request } from '../../api/client.ts';

export const chatDraftsQuery = (conversationId: string) => ({
  queryKey: [...queryKeys.conversation(conversationId), 'outpost-drafts'] as const,
  queryFn: (): Promise<ChatDrafts> =>
    request(chatDraftsSchema, `/conversations/${conversationId}/outpost-drafts`),
});
