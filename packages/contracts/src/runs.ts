import { z } from 'zod';
import { runModeSchema } from './approvals.ts';
import { involvementLevelSchema } from './involvement-levels.ts';
import { modelSwitchSchema } from './model-access.ts';
import { runUsageSchema } from './usage.ts';
import { agentRoleSchema } from './roles.ts';
import { categorySchema } from './categories.ts';
import { todoListSchema } from './artifacts.ts';

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

export const interruptionChoiceSchema = z.enum(['continue', 'fresh']);
export type InterruptionChoice = z.infer<typeof interruptionChoiceSchema>;

export const CONTINUE_MESSAGE = 'Continue from here';
export const STOPPED_BY_QUIT = 'Stopped by Quit.';

export const messageSourceSchema = z.enum(['ui', 'e2e', 'bench']);
export type MessageSource = z.infer<typeof messageSourceSchema>;

export const runSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  userMessageId: z.uuid().nullable(),
  provider: z.string(),
  status: runStatusSchema,
  error: z.string().nullable(),
  cancelRequested: z.boolean(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  model: z.string().nullable(),
  usedModel: z.string().nullable().optional(),
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
  todo: todoListSchema.nullable().optional(),
  continuesRunId: z.uuid().nullable().optional(),
  interruptionChoice: interruptionChoiceSchema.nullable().optional(),
  modelSwitch: modelSwitchSchema.nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  agentCycle: z.boolean().optional(),
  prFollowUp: z.boolean().optional(),
  outpost: z
    .object({
      postId: z.uuid(),
      outpostId: z.uuid(),
      outpostName: z.string(),
      fromHandle: z.string().nullable(),
      fromUser: z.boolean(),
      fromSpark: z.boolean().default(false),
      userStarted: z.boolean().default(false),
      agentStarted: z.boolean().default(false),
    })
    .optional(),
});
export type Run = z.infer<typeof runSchema>;

export const continueRunRequestSchema = z.object({ id: z.uuid() });
export type ContinueRunRequest = z.infer<typeof continueRunRequestSchema>;

export const interruptionBlockSchema = z.enum(['crew']);
export type InterruptionBlock = z.infer<typeof interruptionBlockSchema>;

export const interruptionSchema = z.object({
  runId: z.uuid(),
  stoppedAt: z.string().nullable(),
  blocked: interruptionBlockSchema.nullable(),
});
export type Interruption = z.infer<typeof interruptionSchema>;

export const OUTPOST_DRAFT_ACTIVITY = 'outpost_draft';
export const PUBLISH_NOTE_ACTIVITY = 'publish_note';

export const outpostDraftActivitySchema = z.object({
  draftId: z.uuid(),
  chats: z.number().int().positive(),
  stacked: z.number().int().nonnegative(),
});
export type OutpostDraftActivity = z.infer<typeof outpostDraftActivitySchema>;
