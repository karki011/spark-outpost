import { z } from 'zod';

export const BUILDER_KEEP_HOURS = 24;

export const builderChatSchema = z.object({
  conversationId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  doneAt: z.iso.datetime({ offset: true }).nullable(),
  removeAt: z.iso.datetime({ offset: true }).nullable(),
  sparkId: z.uuid().nullable(),
});
export type BuilderChat = z.infer<typeof builderChatSchema>;

export const currentBuilderChatSchema = z.object({ chat: builderChatSchema.nullable() });
export type CurrentBuilderChat = z.infer<typeof currentBuilderChatSchema>;

export const startBuilderChatSchema = z.object({ id: z.uuid(), sparkId: z.uuid().optional() });
export type StartBuilderChat = z.infer<typeof startBuilderChatSchema>;

export const crewDraftSchema = z.object({
  approvalId: z.uuid(),
  conversationId: z.uuid(),
  target: z.enum(['spark', 'workflow']),
  name: z.string(),
  inBuilder: z.boolean(),
});
export type CrewDraft = z.infer<typeof crewDraftSchema>;

export const crewDraftsSchema = z.object({ drafts: z.array(crewDraftSchema) });
