import { z } from 'zod';
import { checkCommandsSchema } from './checks.ts';
import { buildStyleSchema } from './lean.ts';
import { checkpointKindSchema, checkpointPayloadSchema } from './checkpoints.ts';
import { projectNameSchema } from './projects.ts';

export const runModeSchema = z.enum(['chat', 'ask', 'do']);
export type RunMode = z.infer<typeof runModeSchema>;

export const PERMISSION_ASK = 'ask' as const;
export const PERMISSION_DO = 'do' as const;

export const INVOLVEMENT_LEVEL_IDS = ['balanced', 'hands-off', 'full-auto'] as const;

/** Hands-on was removed on September 28, 2026; stored or sent values read as Balanced. */
export const LEGACY_HANDS_ON = 'hands-on';

export const involvementLevelSchema = z.preprocess(
  (value) => (value === LEGACY_HANDS_ON ? 'balanced' : value),
  z.enum(INVOLVEMENT_LEVEL_IDS),
);
export type InvolvementLevel = (typeof INVOLVEMENT_LEVEL_IDS)[number];

export const DEFAULT_INVOLVEMENT_LEVEL: InvolvementLevel = 'balanced';

export interface InvolvementLevelInfo {
  id: InvolvementLevel;
  label: string;
  hint: string;
}

export const INVOLVEMENT_LEVELS: readonly InvolvementLevelInfo[] = [
  {
    id: 'balanced',
    label: 'Ask before edits',
    hint: "Every edit and every risky command asks. Read-only commands in the project run, and so do commands on the project's allowlist.",
  },
  {
    id: 'hands-off',
    label: 'Auto-edit',
    hint: "Edits and read-only commands go through. Other commands ask unless they're on the project's allowlist.",
  },
  {
    id: 'full-auto',
    label: 'Full auto',
    hint: 'Everything goes through in a separate worktree, then runs to a draft PR; it never merges. Changing or deleting files outside the repo, secret files and package installs still ask.',
  },
];

export const ASK_ACCESS = 'ask';
export type AccessId = typeof ASK_ACCESS | InvolvementLevel;

export interface AccessChoice {
  id: AccessId;
  label: string;
  hint: string;
  permission: typeof PERMISSION_ASK | typeof PERMISSION_DO;
  level: InvolvementLevel | null;
}

export const ASK_ACCESS_CHOICE: AccessChoice = {
  id: ASK_ACCESS,
  label: 'Ask',
  hint: 'Reads the linked repos and answers. Never changes files.',
  permission: PERMISSION_ASK,
  level: null,
};

/** The one list of permission choices users see, safest first. */
export const ACCESS_CHOICES: readonly AccessChoice[] = [
  ASK_ACCESS_CHOICE,
  ...INVOLVEMENT_LEVELS.map((level) => ({
    id: level.id,
    label: level.label,
    hint: level.hint,
    permission: PERMISSION_DO,
    level: level.id,
  })),
];

export function accessFor(
  permission: string | null | undefined,
  level: InvolvementLevel | null | undefined,
): AccessChoice | null {
  if (permission === PERMISSION_ASK) return ASK_ACCESS_CHOICE;
  if (permission !== PERMISSION_DO) return null;
  const id = level ?? DEFAULT_INVOLVEMENT_LEVEL;
  return ACCESS_CHOICES.find((choice) => choice.id === id) ?? null;
}

export function accessChoice(id: string): AccessChoice | null {
  return ACCESS_CHOICES.find((choice) => choice.id === id) ?? null;
}

/** The settings change that selects an access choice: Ask keeps the stored level. */
export function accessUpdate(choice: AccessChoice): {
  permission: string;
  level?: InvolvementLevel;
} {
  return choice.level
    ? { permission: choice.permission, level: choice.level }
    : { permission: choice.permission };
}

export interface DoProviderNotes {
  levels: Record<InvolvementLevel, string>;
  disclosure: string;
  commands: string;
}

export const DEFAULT_COMMAND_NOTE = "Commands aren't sandboxed";

export const DEFAULT_DO_DISCLOSURE =
  "Commands aren't sandboxed. Pushing, deleting outside the repo, secret files and package installs always ask, and you can revert the run.";

export const DO_PROVIDER_NOTES: Readonly<Record<string, DoProviderNotes>> = {
  codex: {
    levels: {
      balanced:
        'Codex asks before every command and file change. Read-only commands in the project are answered for you; the rest come to you.',
      'hands-off':
        "Codex works in a separate git copy that joins your files when it finishes. Commands that aren't read-only or allowlisted come to you.",
      'full-auto':
        "Codex works in a separate git copy. An allowed command may leave Codex's sandbox, reaching the network or files outside the repo.",
    },
    commands: "Runs in Codex's sandbox without network, unless Codex asked to leave it",
    disclosure:
      "Codex's sandbox can read any file on this computer. Spark Outpost asks before any command that names a secret file, but can't see what a search or script reads. Commands run without network; package installs always ask, and you can revert the run.",
  },
};

export function levelHint(
  level: Pick<InvolvementLevelInfo, 'id' | 'hint'>,
  provider: string | null,
): string {
  const note = provider ? DO_PROVIDER_NOTES[provider]?.levels[level.id] : undefined;
  return note ? `${level.hint} ${note}` : level.hint;
}

export function accessHint(choice: AccessChoice, provider: string | null): string {
  return choice.level ? levelHint({ id: choice.level, hint: choice.hint }, provider) : choice.hint;
}

export function commandSandboxNote(provider: string | null): string {
  return (provider ? DO_PROVIDER_NOTES[provider]?.commands : undefined) ?? DEFAULT_COMMAND_NOTE;
}

export function doDisclosure(provider: string | null): string {
  return (provider ? DO_PROVIDER_NOTES[provider]?.disclosure : undefined) ?? DEFAULT_DO_DISCLOSURE;
}

export function involvementLevelLabel(level: InvolvementLevel): string {
  return INVOLVEMENT_LEVELS.find((info) => info.id === level)?.label ?? level;
}

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
  plan: z.string().optional(),
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
