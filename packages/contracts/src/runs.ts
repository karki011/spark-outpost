import { z } from 'zod';
import { runModeSchema } from './approvals.ts';
import { involvementLevelSchema } from './involvement-levels.ts';
import { runUsageSchema } from './usage.ts';
import { agentRoleSchema } from './roles.ts';
import { categorySchema } from './categories.ts';

export const runStatusSchema = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
  'outcome_unknown',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export type TerminalRunStatus = Exclude<RunStatus, 'queued' | 'running' | 'awaiting_approval'>;

const terminalStatuses: ReadonlySet<RunStatus> = new Set<TerminalRunStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'outcome_unknown',
]);

export function isTerminalRunStatus(status: RunStatus): status is TerminalRunStatus {
  return terminalStatuses.has(status);
}

export const activeRunsSchema = z.object({ activeRuns: z.number().int().nonnegative() });
export type ActiveRuns = z.infer<typeof activeRunsSchema>;

export const startAsSchema = z.enum(['change', 'continue']);
export type StartAs = z.infer<typeof startAsSchema>;

export const messageSourceSchema = z.enum(['ui', 'e2e', 'bench']);
export type MessageSource = z.infer<typeof messageSourceSchema>;

export const runSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  userMessageId: z.uuid(),
  provider: z.string(),
  status: runStatusSchema,
  error: z.string().nullable(),
  cancelRequested: z.boolean(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  usage: runUsageSchema.nullable(),
  mode: runModeSchema.nullable(),
  pickedMode: runModeSchema.nullable().optional(),
  startAs: startAsSchema.nullable().optional(),
  level: involvementLevelSchema.nullable(),
  snapshot: z.enum(['git', 'files']).nullable(),
  revertedAt: z.string().nullable(),
  parentRunId: z.uuid().nullable().optional(),
  role: agentRoleSchema.nullable().optional(),
  stepIndex: z.number().int().nullable().optional(),
  agentLabel: z.string().nullable().optional(),
  category: categorySchema.nullable().optional(),
  following: z.array(z.string()).nullable().optional(),
});
export type Run = z.infer<typeof runSchema>;
