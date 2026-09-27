import { z } from 'zod';
import { totalCostSourceSchema } from './audit.ts';
import { providerTotalsSchema } from './usage.ts';

export const spendRangeSchema = z.enum(['today', 'week']);
export type SpendRange = z.infer<typeof spendRangeSchema>;

export const routingSavingsSchema = z.object({
  runs: z.number().int().positive(),
  grossUsd: z.number(),
  jevCostUsd: z.number().nonnegative(),
  netUsd: z.number(),
});
export type RoutingSavings = z.infer<typeof routingSavingsSchema>;

export const spendSummarySchema = z.object({
  range: spendRangeSchema,
  since: z.string(),
  runs: z.number().int().nonnegative(),
  costUsd: z.number().nullable(),
  costSource: totalCostSourceSchema.nullable(),
  totalTokens: z.number().nonnegative(),
  byProvider: z.array(providerTotalsSchema),
  savings: routingSavingsSchema.nullable(),
});
export type SpendSummary = z.infer<typeof spendSummarySchema>;

export const providerIssueKindSchema = z.enum(['auth', 'usage_limit', 'rate_limit']);
export type ProviderIssueKind = z.infer<typeof providerIssueKindSchema>;

export const providerIssueSchema = z.object({
  provider: z.string(),
  kind: providerIssueKindSchema,
  message: z.string(),
  at: z.string(),
});
export type ProviderIssue = z.infer<typeof providerIssueSchema>;

export const providerHealthSchema = z.object({
  issues: z.array(providerIssueSchema),
});
export type ProviderHealth = z.infer<typeof providerHealthSchema>;

const AUTH =
  /isn['’]t signed in|couldn['’]t sign in|not signed in|not logged in|unauthori[sz]ed|\b401\b|invalid api key|authentication/i;
const USAGE_LIMIT = /\b1113\b|usage limit|quota|no balance|insufficient balance|out of credits/i;
const RATE_LIMIT = /\b1302\b|\b1305\b|rate[\s_-]?limit|\b429\b|too many requests|overloaded/i;

export function providerIssueKind(message: string): ProviderIssueKind | null {
  if (AUTH.test(message)) return 'auth';
  if (USAGE_LIMIT.test(message)) return 'usage_limit';
  if (RATE_LIMIT.test(message)) return 'rate_limit';
  return null;
}
