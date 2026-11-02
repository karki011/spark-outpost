import { z } from 'zod';

export const ASSISTANT_HISTORY_PAGE = 20;
export const ASSISTANT_HISTORY_PAGE_MAX = 50;
export const ASSISTANT_ANSWER_LINKS_MAX = 3;

export const assistantTopicSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['topic', 'cleared']),
  at: z.string(),
});
export type AssistantTopic = z.infer<typeof assistantTopicSchema>;

export const assistantChatLinkSchema = z.object({
  conversationId: z.uuid(),
  title: z.string(),
});
export type AssistantChatLink = z.infer<typeof assistantChatLinkSchema>;

export const assistantExchangeSchema = z.object({
  id: z.uuid(),
  question: z.string(),
  askedAt: z.string(),
  runId: z.uuid().nullable(),
  status: z.enum(['waiting', 'answered', 'failed']),
  answer: z.string().nullable(),
  source: assistantChatLinkSchema.nullable(),
  links: z.array(assistantChatLinkSchema).max(ASSISTANT_ANSWER_LINKS_MAX),
});
export type AssistantExchange = z.infer<typeof assistantExchangeSchema>;

export const assistantHistorySchema = z.object({
  exchanges: z.array(assistantExchangeSchema),
  topics: z.array(assistantTopicSchema),
  older: z.uuid().nullable(),
});
export type AssistantHistory = z.infer<typeof assistantHistorySchema>;

export const assistantHistoryQuerySchema = z.object({
  before: z.uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ASSISTANT_HISTORY_PAGE_MAX)
    .default(ASSISTANT_HISTORY_PAGE),
});
export type AssistantHistoryQuery = z.infer<typeof assistantHistoryQuerySchema>;
