import { z } from 'zod';
import { costSourceSchema } from './audit.ts';
import { nativeTerminalProviderSchema } from './native-terminal.ts';
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
  costUsd: z.number().nonnegative(),
  cliSessions: z.number().int().positive(),
  models: z.array(nativeTerminalReportedModelSchema),
  updatedAt: z.string(),
});
export type NativeTerminalReported = z.infer<typeof nativeTerminalReportedSchema>;

export const nativeTerminalUsageSchema = z.object({
  provider: nativeTerminalProviderSchema.nullable(),
  turns: z.array(nativeTerminalTurnSchema),
  reported: nativeTerminalReportedSchema.nullable(),
});
export type NativeTerminalUsage = z.infer<typeof nativeTerminalUsageSchema>;
