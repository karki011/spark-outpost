import { z } from 'zod';
import { verdictCountsSchema } from './analytics.ts';

const count = z.number().int().nonnegative();

export const outcomeTallySchema = verdictCountsSchema.extend({
  turns: count,
  meanScore: z.number().nullable(),
});
export type OutcomeTally = z.infer<typeof outcomeTallySchema>;

export const checkSummarySchema = z.object({
  turns: count,
  firstPassed: count,
  finalPassed: count,
  fixLoops: count,
  rounds: count,
});
export type CheckSummary = z.infer<typeof checkSummarySchema>;

export const loopSummarySchema = z.object({
  turns: count,
  withRetries: count,
  retries: count,
  fixLoops: count,
});
export type LoopSummary = z.infer<typeof loopSummarySchema>;

export const approvalKindWaitSchema = z.object({
  kind: z.string(),
  count,
  medianMs: z.number().int().nonnegative().nullable(),
  p90Ms: z.number().int().nonnegative().nullable(),
});

export const approvalWaitsSchema = z.object({
  count,
  medianMs: z.number().int().nonnegative().nullable(),
  byKind: z.array(approvalKindWaitSchema),
});
export type ApprovalWaits = z.infer<typeof approvalWaitsSchema>;
