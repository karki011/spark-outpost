import { z } from 'zod';
import { costSourceSchema } from './audit.ts';
import { nativeTerminalProviderSchema, type NativeTerminalProvider } from './native-terminal.ts';
import { promptCacheSchema } from './prompt-cache.ts';
import { runStatusSchema } from './runs.ts';
import { tokenUsageSchema } from './usage.ts';

export const nativeTerminalStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentId: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  failed: z.boolean(),
});
export type NativeTerminalStep = z.infer<typeof nativeTerminalStepSchema>;

export const nativeTerminalTurnSchema = z.object({
  runId: z.uuid(),
  startedAt: z.string(),
  status: runStatusSchema,
  model: z.string().nullable(),
  tokens: tokenUsageSchema.nullable(),
  costUsd: z.number().nullable(),
  costSource: costSourceSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  steps: z.array(nativeTerminalStepSchema),
});
export type NativeTerminalTurn = z.infer<typeof nativeTerminalTurnSchema>;

const reportedCount = z.number().int().nonnegative();

export const nativeTerminalReportedModelSchema = z.object({
  model: z.string(),
  input: reportedCount,
  output: reportedCount,
  cachedRead: reportedCount,
  cachedWrite: reportedCount,
  thought: reportedCount,
  costUsd: z.number().nonnegative().nullable(),
});
export type NativeTerminalReportedModel = z.infer<typeof nativeTerminalReportedModelSchema>;

export const nativeTerminalReportedSchema = z.object({
  nativeSessionId: z.string(),
  costUsd: z.number().nonnegative(),
  models: z.array(nativeTerminalReportedModelSchema),
  updatedAt: z.string(),
});
export type NativeTerminalReported = z.infer<typeof nativeTerminalReportedSchema>;

export const nativeTerminalUsageSchema = z.object({
  provider: nativeTerminalProviderSchema.nullable(),
  turns: z.array(nativeTerminalTurnSchema),
  reported: z.array(nativeTerminalReportedSchema),
  stopped: z.boolean().default(false),
  promptCache: promptCacheSchema.optional(),
});
export type NativeTerminalUsage = z.infer<typeof nativeTerminalUsageSchema>;

export type UsageOrigin = 'estimated' | 'reported' | 'unknown';

const CLI_NAMES: Record<NativeTerminalProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

export function usageOriginLabel(
  origin: UsageOrigin,
  provider: NativeTerminalProvider | null = null,
): string {
  if (origin === 'estimated') return 'estimated from tokens';
  if (origin === 'unknown') return 'unknown';
  return `reported by ${provider ? CLI_NAMES[provider] : 'the CLI'}`;
}

export function turnCostOrigin(
  turn: Pick<NativeTerminalTurn, 'costUsd' | 'costSource'>,
): UsageOrigin {
  if (turn.costUsd === null) return 'unknown';
  return turn.costSource === 'reported' ? 'reported' : 'estimated';
}

export function reportedTotalNote(
  provider: NativeTerminalProvider | null,
  reported: readonly NativeTerminalReported[],
  stopped = false,
): string {
  if (reported.length > 0) return usageOriginLabel('reported', provider);
  if (provider === 'claude' && stopped)
    return 'unknown: the session was stopped before Claude Code wrote its total, so only the estimates by turn exist';
  if (provider === 'claude') return 'unknown until Claude Code exits and writes its own total';
  if (provider === 'codex') return 'unknown: Codex reports no cost';
  return usageOriginLabel('unknown');
}

export function reportedSessionTotal(reported: readonly NativeTerminalReported[]): number | null {
  if (reported.length === 0) return null;
  const millionths = reported.reduce((sum, total) => sum + Math.round(total.costUsd * 1e6), 0);
  return millionths / 1e6;
}
