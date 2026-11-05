import { z } from 'zod';
import { totalCostSourceSchema } from './audit.ts';

export const DIGEST_LINES_MAX = 6;
export const DIGEST_SUGGESTIONS_MAX = 3;
export const DIGEST_LINE_MAX_LENGTH = 280;
export const DIGEST_REASON_MAX_LENGTH = 200;
export const DIGEST_DRAFT_MAX_LENGTH = 600;
export const DIGEST_HEADLINE_MAX_LENGTH = 140;
export const DIGEST_ITEMS_MAX = 5;
export const DIGEST_ITEM_MAX_LENGTH = 240;

export const digestLineSchema = z.object({
  text: z.string().trim().min(1).max(DIGEST_LINE_MAX_LENGTH),
  chatId: z.uuid().nullable(),
});
export type DigestLine = z.infer<typeof digestLineSchema>;

export const digestSuggestionSchema = z.object({
  chatId: z.uuid(),
  reason: z.string().trim().min(1).max(DIGEST_REASON_MAX_LENGTH),
  draft: z.string().trim().min(1).max(DIGEST_DRAFT_MAX_LENGTH),
});
export type DigestSuggestion = z.infer<typeof digestSuggestionSchema>;

export const digestItemSchema = z.object({
  itemId: z.string().min(1).max(200),
  text: z.string().trim().min(1).max(DIGEST_ITEM_MAX_LENGTH),
});
export type DigestItem = z.infer<typeof digestItemSchema>;

export const digestBodySchema = z.object({
  headline: z.string().trim().min(1).max(DIGEST_HEADLINE_MAX_LENGTH),
  lines: z.array(digestLineSchema).max(DIGEST_LINES_MAX),
  suggestions: z.array(digestSuggestionSchema).max(DIGEST_SUGGESTIONS_MAX),
  items: z.array(digestItemSchema).max(DIGEST_ITEMS_MAX).default([]),
  structured: z.boolean(),
});
export type DigestBody = z.infer<typeof digestBodySchema>;

export const digestReplySchema = z.object({
  headline: z.string().optional(),
  lines: z
    .array(
      z.object({
        text: z.string(),
        chatId: z.string().nullable().optional(),
      }),
    )
    .default([]),
  suggestions: z
    .array(z.object({ chatId: z.string(), reason: z.string(), draft: z.string() }))
    .default([]),
  items: z.array(z.object({ itemId: z.string(), text: z.string() })).default([]),
});
export type DigestReply = z.infer<typeof digestReplySchema>;

export const digestStatsSchema = z.object({
  finished: z.number().int().min(0),
  waiting: z.number().int().min(0),
  failedOrStalled: z.number().int().min(0),
  costUsd: z.number().nullable(),
});
export type DigestStats = z.infer<typeof digestStatsSchema>;

export const digestStatusSchema = z.enum(['running', 'ready', 'failed']);
export type DigestStatus = z.infer<typeof digestStatusSchema>;

export const digestSchema = z.object({
  id: z.uuid(),
  status: digestStatusSchema,
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  since: z.string(),
  body: digestBodySchema.nullable(),
  error: z.string().nullable(),
  provider: z.string(),
  modelLabel: z.string().nullable(),
  costUsd: z.number().nullable(),
  costSource: totalCostSourceSchema.nullable(),
  conversationId: z.uuid().nullable(),
  stats: digestStatsSchema,
});
export type Digest = z.infer<typeof digestSchema>;

export const digestStateSchema = z.object({
  available: z.boolean(),
  digest: digestSchema.nullable(),
  newActivity: z.boolean(),
  refreshableAt: z.string().nullable(),
});
export type DigestState = z.infer<typeof digestStateSchema>;

export const digestTriggerSchema = z.object({ trigger: z.enum(['open', 'refresh']) });
export type DigestTrigger = z.infer<typeof digestTriggerSchema>['trigger'];
