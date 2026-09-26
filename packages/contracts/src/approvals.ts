import { z } from 'zod';
import { checkCommandsSchema } from './checks.ts';
import { buildStyleSchema } from './lean.ts';
import { checkpointKindSchema, checkpointPayloadSchema } from './checkpoints.ts';
import { projectNameSchema } from './projects.ts';

export const runModeSchema = z.enum(['chat', 'ask', 'do']);
export type RunMode = z.infer<typeof runModeSchema>;

export const involvementLevelSchema = z.enum(['hands-on', 'balanced', 'hands-off', 'full-auto']);
export type InvolvementLevel = z.infer<typeof involvementLevelSchema>;

export const DEFAULT_INVOLVEMENT_LEVEL: InvolvementLevel = 'balanced';

export interface InvolvementLevelInfo {
  id: InvolvementLevel;
  label: string;
  hint: string;
}

export const INVOLVEMENT_LEVELS: readonly InvolvementLevelInfo[] = [
  { id: 'hands-on', label: 'Hands-on', hint: 'You approve every edit and every command.' },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: "Every edit asks. Commands ask unless they're on the project's allowlist.",
  },
  {
    id: 'hands-off',
    label: 'Hands-off',
    hint: "Edits go through. Commands ask unless they're on the allowlist.",
  },
  {
    id: 'full-auto',
    label: 'Full auto',
    hint: 'Only pushing, deleting outside the repo, and secret files ask. Every action still gets a receipt.',
  },
];

export function involvementLevelLabel(level: InvolvementLevel): string {
  return INVOLVEMENT_LEVELS.find((info) => info.id === level)?.label ?? level;
}

export const PERMISSION_ASK = 'ask';
export const PERMISSION_DO = 'do';

export const approvalKindSchema = z.enum([
  'edit',
  'execute',
  'other',
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

export const approvalScopeSchema = z.enum(['once', 'run', 'project']);
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
});
export type ApprovalOption = z.infer<typeof approvalOptionSchema>;

export const fileDiffSchema = z.object({
  path: z.string(),
  oldText: z.string().nullable(),
  newText: z.string(),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;

export const approvalPayloadSchema = z.object({
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  paths: z.array(z.string()),
  fullPaths: z.array(z.string()).optional(),
  diffs: z.array(fileDiffSchema),
  truncated: z.boolean(),
  checkpoint: checkpointPayloadSchema.optional(),
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
});
export type Approval = z.infer<typeof approvalSchema>;

export const APPROVAL_NOTE_MAX_LENGTH = 4000;

export const approvalDecisionRequestSchema = z.object({
  optionId: z.string().min(1).max(200),
  scope: approvalScopeSchema.default('once'),
  payloadHash: z.string().min(1).max(200).optional(),
  note: z.string().trim().max(APPROVAL_NOTE_MAX_LENGTH).optional(),
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
    buildStyle: buildStyleSchema.optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.commandAllowlist !== undefined ||
      body.checkCommands !== undefined ||
      body.buildStyle !== undefined,
  );
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
