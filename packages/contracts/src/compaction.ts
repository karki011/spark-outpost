import { z } from 'zod';

export const COMPACT_WARN_DEFAULT = 60;
export const COMPACT_AT_DEFAULT = 80;
export const COMPACT_WARN_MIN = 30;
export const COMPACT_WARN_MAX = 90;
export const COMPACT_AT_MIN = 40;
export const COMPACT_AT_MAX = 95;
export const COMPACT_MIN_GAP = 5;
const COMPACT_REASK_STEP = 10;
const COMPACT_REASK_MAX = 95;

export const compactWarnPercentSchema = z
  .number()
  .int()
  .min(COMPACT_WARN_MIN)
  .max(COMPACT_WARN_MAX);
export const compactAtPercentSchema = z.number().int().min(COMPACT_AT_MIN).max(COMPACT_AT_MAX);

export interface CompactionThresholds {
  warnPercent: number;
  compactPercent: number;
  autoCompact: boolean;
}

export const DEFAULT_COMPACTION_THRESHOLDS: CompactionThresholds = {
  warnPercent: COMPACT_WARN_DEFAULT,
  compactPercent: COMPACT_AT_DEFAULT,
  autoCompact: true,
};

export const COMPACT_WARN_RANGE_ERROR = `Warn at a value from ${COMPACT_WARN_MIN}% to ${COMPACT_WARN_MAX}%.`;
export const COMPACT_AT_RANGE_ERROR = `Compact at a value from ${COMPACT_AT_MIN}% to ${COMPACT_AT_MAX}%.`;
export const COMPACT_GAP_ERROR = `Warn at least ${COMPACT_MIN_GAP} points below the compaction point.`;

export function compactionThresholdError(
  warnPercent: number,
  compactPercent: number,
): string | null {
  if (!compactWarnPercentSchema.safeParse(warnPercent).success) return COMPACT_WARN_RANGE_ERROR;
  if (!compactAtPercentSchema.safeParse(compactPercent).success) return COMPACT_AT_RANGE_ERROR;
  if (warnPercent + COMPACT_MIN_GAP > compactPercent) return COMPACT_GAP_ERROR;
  return null;
}

export function reaskPercent(compactPercent: number): number {
  return Math.min(COMPACT_REASK_MAX, compactPercent + COMPACT_REASK_STEP);
}

export type ContextLevel = 'ok' | 'warm' | 'hot';

export function contextLevel(percent: number, thresholds: CompactionThresholds): ContextLevel {
  if (percent >= thresholds.compactPercent) return 'hot';
  if (percent >= thresholds.warnPercent) return 'warm';
  return 'ok';
}

export const compactionMethodSchema = z.enum(['agent', 'spark', 'agent-auto']);
export type CompactionMethod = z.infer<typeof compactionMethodSchema>;

export const compactionSchema = z.object({
  id: z.uuid(),
  runId: z.uuid().nullable(),
  method: compactionMethodSchema,
  tokensBefore: z.number().int().nullable(),
  tokensAfter: z.number().int().nullable(),
  contextSize: z.number().int().nullable(),
  summary: z.string().nullable(),
  fromConversationId: z.uuid().nullable(),
  fromTitle: z.string().nullable(),
  createdAt: z.string(),
});
export type Compaction = z.infer<typeof compactionSchema>;

export const continuationSchema = z.object({
  conversationId: z.uuid(),
  title: z.string(),
  runId: z.uuid().nullable(),
});
export type Continuation = z.infer<typeof continuationSchema>;
