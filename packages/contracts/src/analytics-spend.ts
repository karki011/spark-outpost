import { z } from 'zod';
import { analyticsWindowSchema } from './analytics.ts';
import { outcomeVerdictSchema } from './outcomes.ts';

const count = z.number().int().nonnegative();
const usd = z.number().nonnegative();

export const spendLeafSchema = z.object({
  project: z.string(),
  provider: z.string(),
  model: z.string(),
  modelLabel: z.string(),
  runs: count,
  costUsd: usd,
  reportedUsd: usd,
  estimatedUsd: usd,
});
export type SpendLeaf = z.infer<typeof spendLeafSchema>;

export const spendDaySchema = z.object({
  date: z.string(),
  reportedUsd: usd,
  estimatedUsd: usd,
});
export type SpendDay = z.infer<typeof spendDaySchema>;

export const taskCostSchema = z.object({
  verdict: outcomeVerdictSchema,
  tasks: count,
  costUsd: usd,
  meanUsd: usd.nullable(),
  medianUsd: usd.nullable(),
});
export type TaskCost = z.infer<typeof taskCostSchema>;

export const resumeSavingsSchema = z.object({
  resumedRuns: count,
  sessionRuns: count,
  cachedTokens: count,
  savedUsd: usd,
});
export type ResumeSavings = z.infer<typeof resumeSavingsSchema>;

export const analyticsSpendSchema = z.object({
  window: analyticsWindowSchema,
  totalUsd: usd,
  reportedUsd: usd,
  estimatedUsd: usd,
  unpricedRuns: count,
  jev: z.object({ calls: count, costUsd: usd }),
  leaves: z.array(spendLeafSchema),
  days: z.array(spendDaySchema),
  perTask: z.array(taskCostSchema),
  finishedTasks: count,
  costPerGoodUsd: usd.nullable(),
  resume: resumeSavingsSchema,
});
export type AnalyticsSpend = z.infer<typeof analyticsSpendSchema>;
