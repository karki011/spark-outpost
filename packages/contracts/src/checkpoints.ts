import { z } from 'zod';
import { planEntrySchema } from './artifacts.ts';
import { involvementLevelSchema } from './involvement-levels.ts';

export const checkpointKindSchema = z.enum([
  'clarify',
  'plan',
  'retry',
  'accept',
  'budget',
  'merge_conflict',
  'stuck',
  'verify',
  'ownership',
  'pieces',
  'pr_split',
  'compact',
]);
export type CheckpointKind = z.infer<typeof checkpointKindSchema>;

export const CHECKPOINT_OPTION = {
  stop: 'stop',
  clarifyRules: 'rules',
  answer: 'answer',
  approvePlan: 'approve',
  editPlan: 'edit',
  retry: 'retry',
  finish: 'finish',
  keep: 'keep',
  fix: 'fix',
  fixFindings: 'fix_findings',
  revert: 'revert',
  keepFirst: 'keep_first',
  keepSecond: 'keep_second',
  reconcile: 'reconcile',
  nudge: 'nudge',
  letContinue: 'let_continue',
  continueStuck: 'continue_stuck',
  stopReport: 'stop_report',
  justAnswer: 'just_answer',
  makeChange: 'make_change',
  finishUnverified: 'finish_unverified',
  keepInPiece: 'keep_in_piece',
  revertFile: 'revert_file',
  buildInOrder: 'build_in_order',
  useDefaults: 'defaults',
  onePr: 'one_pr',
  separatePrs: 'separate_prs',
  alwaysOnePr: 'always_one_pr',
  alwaysSeparatePrs: 'always_separate_prs',
  compactNow: 'compact_now',
  freshChat: 'fresh_chat',
  keepGoing: 'keep_going',
} as const;

export const clarifyOptionId = (index: number): string => `option:${index}`;

export const NOTE_OPTIONS: readonly string[] = [
  CHECKPOINT_OPTION.answer,
  CHECKPOINT_OPTION.editPlan,
  CHECKPOINT_OPTION.fix,
];

export const routeSourceSchema = z.enum(['jev', 'rules', 'pinned', 'fixed']);
export type RouteSource = z.infer<typeof routeSourceSchema>;

export const agentPickSchema = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  modelLabel: z.string().nullable(),
  effort: z.string().nullable(),
});
export type AgentPick = z.infer<typeof agentPickSchema>;

export const conflictSideSchema = z.object({
  name: z.string(),
  runId: z.uuid().nullable(),
  diff: z.string(),
  text: z.string().nullable(),
});
export const mergeConflictSchema = z.object({
  first: z.string(),
  second: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      base: z.string().nullable(),
      first: conflictSideSchema,
      second: conflictSideSchema,
    }),
  ),
});
export const checkpointQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).default([]),
  default: z.string(),
});
export type CheckpointQuestion = z.infer<typeof checkpointQuestionSchema>;

export const checkpointPayloadSchema = z.object({
  kind: checkpointKindSchema,
  question: z.string(),
  reason: z.string(),
  choices: z.array(z.string()).default([]),
  questions: z.array(checkpointQuestionSchema).default([]),
  plan: z.array(planEntrySchema).default([]),
  planVersion: z.number().int().positive().nullable().default(null),
  from: agentPickSchema.nullable().default(null),
  to: agentPickSchema.nullable().default(null),
  files: z
    .array(z.object({ path: z.string(), change: z.enum(['added', 'modified', 'deleted']) }))
    .default([]),
  conflict: mergeConflictSchema.nullable().default(null),
  agent: z.string().nullable().default(null),
  autoOption: z.string().nullable().default(null),
  waitsFor: z.string().nullable().default(null),
  keptBy: involvementLevelSchema.nullable().default(null),
  keptNote: z.string().nullable().default(null),
  laws: z.array(z.string()).default([]),
  outsidePlan: z.array(z.string()).default([]),
  lines: z
    .object({ added: z.number().int().nonnegative(), removed: z.number().int().nonnegative() })
    .nullable()
    .default(null),
  checks: z
    .object({
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      unsettled: z.number().int().nonnegative(),
    })
    .nullable()
    .default(null),
  keptAt: z
    .object({ branch: z.string().nullable(), commit: z.string().nullable() })
    .nullable()
    .default(null),
  estimate: z.string().nullable().default(null),
  askAgainAt: z.number().int().nullable().default(null),
});
export type CheckpointPayload = z.infer<typeof checkpointPayloadSchema>;

export function isCheckpointKind(kind: string): kind is CheckpointKind {
  return checkpointKindSchema.safeParse(kind).success;
}
