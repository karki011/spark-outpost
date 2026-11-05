import { z } from 'zod';
import { totalCostSourceSchema } from './audit.ts';

export const ANALYTICS_MAX_DAYS = 366;
export const ANALYTICS_SMALL_N = 10;

export const analyticsRangeSchema = z.enum(['7d', '30d', '90d', 'custom']);
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

export const RANGE_DAYS: Record<Exclude<AnalyticsRange, 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export const analyticsQuerySchema = z
  .object({
    range: analyticsRangeSchema.default('30d'),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine(
    (query) => query.range !== 'custom' || (query.from && query.to && query.from <= query.to),
    {
      message: 'A custom range needs from and to dates, with from on or before to.',
    },
  );
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const analyticsWindowSchema = z.object({
  range: analyticsRangeSchema,
  from: isoDate,
  to: isoDate,
  days: z.number().int().positive(),
  timeZone: z.string(),
});
export type AnalyticsWindow = z.infer<typeof analyticsWindowSchema>;

const count = z.number().int().nonnegative();

export const verdictCountsSchema = z.object({
  good: count,
  bad: count,
  mixed: count,
  unclear: count,
});
export type VerdictCounts = z.infer<typeof verdictCountsSchema>;

export const rollupGroupBySchema = z.enum([
  'day',
  'project',
  'provider',
  'model',
  'category',
  'jev_decision',
]);
export type RollupGroupBy = z.infer<typeof rollupGroupBySchema>;

export const rollupQuerySchema = z.object({ groupBy: rollupGroupBySchema.default('day') });

export const rollupRowSchema = verdictCountsSchema.extend({
  key: z.string(),
  turns: count,
  runs: count,
  costUsd: z.number().nonnegative(),
  reportedUsd: z.number().nonnegative(),
  estimatedUsd: z.number().nonnegative(),
  tokens: count,
  meanScore: z.number().nullable(),
  kept: count,
  reverted: count,
  corrections: count,
  retries: count,
});
export type RollupRow = z.infer<typeof rollupRowSchema>;

export const rollupReportSchema = z.object({
  window: analyticsWindowSchema,
  groupBy: rollupGroupBySchema,
  rows: z.array(rollupRowSchema),
});
export type RollupReport = z.infer<typeof rollupReportSchema>;

export const healthComponentIdSchema = z.enum([
  'outcomes',
  'checks',
  'corrections',
  'loops',
  'waits',
]);
export type HealthComponentId = z.infer<typeof healthComponentIdSchema>;

export const healthComponentSchema = z.object({
  id: healthComponentIdSchema,
  label: z.string(),
  score: z.number().min(0).max(100).nullable(),
  weight: z.number().nonnegative(),
  n: count,
  detail: z.string(),
});
export type HealthComponent = z.infer<typeof healthComponentSchema>;

export const healthGradeSchema = z.enum(['healthy', 'fair', 'needs_attention', 'not_enough_data']);
export type HealthGrade = z.infer<typeof healthGradeSchema>;

export const healthScoreSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  grade: healthGradeSchema,
  components: z.array(healthComponentSchema),
});
export type HealthScore = z.infer<typeof healthScoreSchema>;

export const overviewDaySchema = verdictCountsSchema.extend({
  date: isoDate,
  turns: count,
  runs: count,
  costUsd: z.number().nonnegative(),
  kept: count,
  reverted: count,
});
export type OverviewDay = z.infer<typeof overviewDaySchema>;

export const overviewTotalsSchema = verdictCountsSchema.extend({
  turns: count,
  runs: count,
  costUsd: z.number().nonnegative(),
  costSource: totalCostSourceSchema.nullable(),
  meanScore: z.number().nullable(),
  kept: count,
  reverted: count,
  keepRate: z.number().min(0).max(1).nullable(),
  checkRounds: count,
  checkTurns: count,
  checksPassedFirst: count,
  checkPassRate: z.number().min(0).max(1).nullable(),
});
export type OverviewTotals = z.infer<typeof overviewTotalsSchema>;

export const analyticsOverviewSchema = z.object({
  window: analyticsWindowSchema,
  days: z.array(overviewDaySchema),
  totals: overviewTotalsSchema,
  health: healthScoreSchema,
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

export function isSmallSample(n: number): boolean {
  return n < ANALYTICS_SMALL_N;
}
