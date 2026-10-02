import { z } from 'zod';
import { checkCommandsSchema } from './checks.ts';
import { checkpointKindSchema, checkpointPayloadSchema } from './checkpoints.ts';
import type { InvolvementLevel } from './involvement-levels.ts';
import { workPlaceSchema } from './chat-workspace.ts';
import { pieceSlotsSchema, projectNameSchema } from './projects.ts';
import { SPARK_ACTION_KIND, sparkActionEditsSchema, sparkActionSchema } from './spark-actions.ts';

export const runModeSchema = z.enum(['chat', 'ask', 'do']);
export type RunMode = z.infer<typeof runModeSchema>;

export const PERMISSION_ASK = 'ask' as const;
export const PERMISSION_DO = 'do' as const;

export const DEFAULT_INVOLVEMENT_LEVEL: InvolvementLevel = 'hands-off';

export interface InvolvementLevelInfo {
  id: InvolvementLevel;
  label: string;
  hint: string;
}

export const AUTONOMY_LEVELS: readonly InvolvementLevelInfo[] = [
  {
    id: 'hands-off',
    label: 'Automatic',
    hint: 'Keeps changes without stopping. Risky work uses a worktree copy. Revert is always there.',
  },
  {
    id: 'full-auto',
    label: 'Full auto → PR',
    hint: 'Same as Automatic in a worktree copy, then opens a PR. Nothing ever merges.',
  },
];

export function autonomyLabel(level: InvolvementLevel): string {
  return AUTONOMY_LEVELS.find((info) => info.id === level)?.label ?? level;
}

export const approvalKindSchema = z.enum([
  'edit',
  'execute',
  'other',
  SPARK_ACTION_KIND,
  ...checkpointKindSchema.options,
]);
export type ApprovalKind = z.infer<typeof approvalKindSchema>;

export const approvalStatusSchema = z.enum([
  'pending',
  'allowed',
  'denied',
  'cancelled',
  'expired',
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalScopeSchema = z.enum(['once', 'run', 'chat', 'project']);
export type ApprovalScope = z.infer<typeof approvalScopeSchema>;

export const approvalDeciderSchema = z.enum([
  'user',
  'level',
  'run_rule',
  'allowlist',
  'policy',
  'stop',
  'timeout',
  'recovery',
  'auto',
  'jev',
]);
export type ApprovalDecider = z.infer<typeof approvalDeciderSchema>;

export const approvalOptionKindSchema = z.enum([
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
]);

export const approvalOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: approvalOptionKindSchema,
  unavailableReason: z.string().optional(),
});
export type ApprovalOption = z.infer<typeof approvalOptionSchema>;

export const fileDiffSchema = z.object({
  path: z.string(),
  oldText: z.string().nullable(),
  newText: z.string(),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;

export const autoDecisionSchema = z.object({
  by: z.enum(['rules', 'jev']),
  pick: z.enum(['allow', 'ask']).nullable(),
  why: z.string(),
  jev: z
    .object({
      status: z.string(),
      risk: z.number().nullable(),
      model: z.string().nullable(),
      costUsd: z.number().nullable(),
    })
    .optional(),
});
export type AutoDecision = z.infer<typeof autoDecisionSchema>;

export const approvalPayloadSchema = z.object({
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  paths: z.array(z.string()),
  fullPaths: z.array(z.string()).optional(),
  diffs: z.array(fileDiffSchema),
  truncated: z.boolean(),
  checkpoint: checkpointPayloadSchema.optional(),
  plan: z.string().optional(),
  forcePush: z.array(z.string()).optional(),
  instructionFiles: z.array(z.string()).optional(),
  gitControl: z.array(z.string()).optional(),
  asksBecause: z.string().optional(),
  observed: z.array(z.string()).optional(),
  sparkAction: sparkActionSchema.optional(),
  agentReason: z.string().optional(),
  autoDecision: autoDecisionSchema.optional(),
});
export type ApprovalPayload = z.infer<typeof approvalPayloadSchema>;

export const approvalSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  toolCallId: z.string(),
  kind: approvalKindSchema,
  title: z.string(),
  payload: approvalPayloadSchema,
  payloadHash: z.string(),
  options: z.array(approvalOptionSchema),
  status: approvalStatusSchema,
  reason: z.string().nullable(),
  decisionOptionId: z.string().nullable(),
  scope: approvalScopeSchema.nullable(),
  decidedBy: approvalDeciderSchema.nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  note: z.string().nullable().optional(),
  autoContinueAt: z.string().nullable().optional(),
  edits: sparkActionEditsSchema.nullable().optional(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const CHECK_TOOL_CALL_PREFIX = 'check:';

export function isCheckApproval(approval: Pick<Approval, 'toolCallId'>): boolean {
  return approval.toolCallId.startsWith(CHECK_TOOL_CALL_PREFIX);
}

export const APPROVAL_NOTE_MAX_LENGTH = 4000;

export const approvalDecisionRequestSchema = z.object({
  optionId: z.string().min(1).max(200),
  scope: approvalScopeSchema.default('once'),
  payloadHash: z.string().min(1).max(200).optional(),
  note: z.string().trim().max(APPROVAL_NOTE_MAX_LENGTH).optional(),
  edits: sparkActionEditsSchema.optional(),
});
export type ApprovalDecisionRequest = z.input<typeof approvalDecisionRequestSchema>;

export const APPROVAL_REQUESTED = 'approval_requested';
export const APPROVAL_DECIDED = 'approval_decided';

export const approvalDecidedValueSchema = approvalSchema.pick({
  id: true,
  status: true,
  decisionOptionId: true,
  scope: true,
  decidedBy: true,
  decidedAt: true,
});
export type ApprovalDecidedValue = z.infer<typeof approvalDecidedValueSchema>;

export const COMMAND_ALLOWLIST_MAX = 100;

export const commandAllowlistSchema = z
  .array(z.string().trim().min(1).max(500))
  .max(COMMAND_ALLOWLIST_MAX)
  .transform((entries) => [...new Set(entries)]);

export const updateProjectRequestSchema = z
  .object({
    name: projectNameSchema.optional(),
    commandAllowlist: commandAllowlistSchema.optional(),
    checkCommands: checkCommandsSchema.nullable().optional(),
    parallelPieces: z.boolean().optional(),
    pieceSlots: pieceSlotsSchema.optional(),
    workPlace: workPlaceSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined));
export type UpdateProjectRequest = z.input<typeof updateProjectRequestSchema>;

export const runChangeSchema = z.object({
  path: z.string(),
  change: z.enum(['added', 'modified', 'deleted']),
});
export type RunChange = z.infer<typeof runChangeSchema>;

export const runChangesSchema = z.object({
  revertible: z.boolean(),
  revertedAt: z.string().nullable(),
  files: z.array(runChangeSchema),
  reason: z.string().nullable(),
});
export type RunChanges = z.infer<typeof runChangesSchema>;

export const revertRunResponseSchema = z.object({
  restored: z.array(runChangeSchema),
  revertedAt: z.string(),
});
export type RevertRunResponse = z.infer<typeof revertRunResponseSchema>;
