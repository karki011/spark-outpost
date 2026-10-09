import { z } from 'zod';
import { queryKeys, request } from '../../api/client.ts';

const chatDraftSchema = z.object({
  id: z.uuid(),
  runId: z.uuid().nullable(),
  chats: z.number().int().positive(),
  stacked: z.number().int().nonnegative(),
  outpostId: z.uuid().nullable(),
  startedAt: z.string().nullable(),
});
export type ChatDraft = z.infer<typeof chatDraftSchema>;

const chatDraftsSchema = z.object({ drafts: z.array(chatDraftSchema) });
export type ChatDrafts = z.infer<typeof chatDraftsSchema>;

export const chatDraftsQuery = (conversationId: string) => ({
  queryKey: [...queryKeys.conversation(conversationId), 'outpost-drafts'] as const,
  queryFn: (): Promise<ChatDrafts> =>
    request(chatDraftsSchema, `/conversations/${conversationId}/outpost-drafts`),
});
