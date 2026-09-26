import { z } from 'zod';
import { advisorUsageSchema } from './advice.ts';
import { costSourceSchema, totalCostSourceSchema } from './audit.ts';
import { categorySchema } from './categories.ts';

const tokenCount = z.number().int().nonnegative();

export const tokenUsageSchema = z.object({
  input: tokenCount,
  output: tokenCount,
  total: tokenCount,
  cachedRead: tokenCount.nullable(),
  cachedWrite: tokenCount.nullable(),
  thought: tokenCount.nullable(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const runUsageSchema = z.object({
  contextUsed: z.number().int().nullable(),
  contextSize: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  costSource: costSourceSchema.nullable().optional(),
  tokens: tokenUsageSchema.nullable(),
});
export type RunUsage = z.infer<typeof runUsageSchema>;

export const providerTotalsSchema = z.object({
  provider: z.string(),
  runs: z.number().int().nonnegative(),
  costUsd: z.number().nullable(),
  costSource: totalCostSourceSchema.nullable().optional(),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  totalTokens: tokenCount,
});
export type ProviderTotals = z.infer<typeof providerTotalsSchema>;

export const providerChatUsageSchema = providerTotalsSchema.extend({
  lastContextUsed: z.number().int().nullable(),
  lastContextSize: z.number().int().nullable(),
});
export type ProviderChatUsage = z.infer<typeof providerChatUsageSchema>;

export const conversationUsageSchema = z.object({
  costUsd: z.number().nullable(),
  costSource: totalCostSourceSchema.nullable().optional(),
  totalTokens: tokenCount,
  byProvider: z.array(providerChatUsageSchema),
  advisors: z.array(advisorUsageSchema).optional(),
});
export type ConversationUsage = z.infer<typeof conversationUsageSchema>;

export const categoryTotalsSchema = z.object({
  category: categorySchema.nullable(),
  turns: z.number().int().nonnegative(),
  costUsd: z.number().nullable(),
  costSource: totalCostSourceSchema.nullable(),
  totalTokens: tokenCount,
});
export type CategoryTotals = z.infer<typeof categoryTotalsSchema>;

export const usageSummarySchema = z.object({
  last30Days: z.array(providerTotalsSchema),
  allTime: z.array(providerTotalsSchema),
  advisors: z
    .object({ last30Days: z.array(advisorUsageSchema), allTime: z.array(advisorUsageSchema) })
    .optional(),
  byCategory: z
    .object({ last30Days: z.array(categoryTotalsSchema), allTime: z.array(categoryTotalsSchema) })
    .optional(),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const EMPTY_CONVERSATION_USAGE: ConversationUsage = {
  costUsd: null,
  totalTokens: 0,
  byProvider: [],
};
