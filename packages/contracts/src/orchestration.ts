import { z } from 'zod';
import { depthSchema, gateSchema, jevStatusSchema, riskSchema } from './advice.ts';
import { approvalSchema, runModeSchema } from './approvals.ts';
import { involvementLevelSchema } from './involvement-levels.ts';
import { modelSwitchSchema } from './model-access.ts';
import { costSourceSchema, totalCostSourceSchema } from './audit.ts';
import { runStatusSchema } from './runs.ts';
import { agentPickSchema, routeSourceSchema } from './checkpoints.ts';
import { pieceListSchema, piecePlacementSchema } from './pieces.ts';
import { agentRoleSchema } from './roles.ts';

export const orchestrationPhaseSchema = z.enum([
  'intake',
  'scouting',
  'planning',
  'building',
  'reviewing',
  'waiting',
  'finished',
]);
export type OrchestrationPhase = z.infer<typeof orchestrationPhaseSchema>;

export const reviewVerdictSchema = z.enum(['looks_good', 'concerns', 'unclear']);
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const reviewBodySchema = z.object({
  reviewer: agentPickSchema,
  verdict: reviewVerdictSchema,
  findings: z.array(z.string()),
  text: z.string(),
  label: z.literal('AI review'),
  sameProvider: z.boolean().optional(),
  net: z.number().int().nonpositive().nullable().optional(),
});
export type ReviewBody = z.infer<typeof reviewBodySchema>;

export const decisionKindSchema = z.enum([
  'intake',
  'route',
  'transition',
  'parallel',
  'build_style',
  'watchdog',
  'policy',
  'verify',
  'finding',
]);
export const decisionAppliedSchema = z.enum(['jev', 'rules', 'asked', 'pinned']);
export const orchestrationDecisionSchema = z.object({
  id: z.uuid(),
  kind: decisionKindSchema,
  role: agentRoleSchema.nullable(),
  stepIndex: z.number().int().nullable(),
  childRunId: z.uuid().nullable(),
  summary: z.string(),
  applied: decisionAppliedSchema,
  gate: gateSchema.nullable(),
  jevStatus: jevStatusSchema,
  jevError: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  tokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  answer: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type OrchestrationDecision = z.infer<typeof orchestrationDecisionSchema>;

export const crewSparkSchema = z.object({
  id: z.uuid(),
  role: z.string(),
  only: z.boolean(),
});
export type CrewSpark = z.infer<typeof crewSparkSchema>;

export const crewMemberSchema = z.object({
  runId: z.uuid(),
  role: agentRoleSchema,
  stepIndex: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  name: z.string(),
  agentLabel: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  modelLabel: z.string().nullable(),
  effort: z.string().nullable(),
  mode: runModeSchema.nullable(),
  routedBy: routeSourceSchema,
  autoWouldUse: agentPickSchema.nullable(),
  planStep: z.string().nullable(),
  status: runStatusSchema,
  error: z.string().nullable(),
  tokens: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  costSource: costSourceSchema.nullable(),
  durationMs: z.number().int().nullable(),
  toolCalls: z.number().int().nullable(),
  contextUsed: z.number().int().nullable().optional(),
  contextSize: z.number().int().nullable().optional(),
  quality: z.number().nullable(),
  verdict: reviewVerdictSchema.nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  copy: z.string().nullable().optional(),
  pieceKey: z.string().optional(),
  placement: piecePlacementSchema.optional(),
  sameProvider: z.boolean().optional(),
  routeNote: z.string().optional(),
  answers: z.uuid().optional(),
  spark: crewSparkSchema.optional(),
  modelSwitch: modelSwitchSchema.optional(),
  errorDetails: z.string().optional(),
});
export type CrewMember = z.infer<typeof crewMemberSchema>;

const orchestrationUsageSchema = z.object({
  activeMs: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});

const totalsFields = {
  runs: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  costSource: totalCostSourceSchema.nullable(),
  durationMs: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
};

export const orchestrationTotalsSchema = z.object({
  ...totalsFields,
  jevCalls: z.number().int().nonnegative(),
  jevTokens: z.number().int().nonnegative(),
  jevCostUsd: z.number().nonnegative(),
  byRole: z.array(z.object({ role: agentRoleSchema, ...totalsFields })),
  byModel: z.array(
    z.object({ provider: z.string(), model: z.string().nullable(), ...totalsFields }),
  ),
});
export type OrchestrationTotals = z.infer<typeof orchestrationTotalsSchema>;

export const MAX_REPAIR_RETRIES = 2;

export const jevAskSchema = z.object({
  kind: z.enum(['models', 'check']),
  pieces: z.number().int().positive().nullable(),
});
export const orchestrationSchema = z.object({
  runId: z.uuid(),
  conversationId: z.uuid(),
  taskId: z.uuid().nullable(),
  status: runStatusSchema,
  phase: orchestrationPhaseSchema,
  depth: depthSchema,
  depthSource: z.enum(['jev', 'rules', 'user']),
  risk: riskSchema,
  level: involvementLevelSchema,
  provider: z.string(),
  planVersion: z.number().int().nullable(),
  retries: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
  crew: z.array(crewMemberSchema),
  answers: z.array(crewMemberSchema).optional(),
  checkpoints: z.array(approvalSchema),
  pendingCheckpoint: approvalSchema.nullable(),
  decisions: z.array(orchestrationDecisionSchema),
  pieces: pieceListSchema.optional(),
  jevAsk: jevAskSchema.optional(),
  usage: orchestrationUsageSchema.optional(),
  totals: orchestrationTotalsSchema,
  error: z.string().nullable(),
  updatedAt: z.string(),
});
export type Orchestration = z.infer<typeof orchestrationSchema>;

export const ORCHESTRATION_ACTIVITY = 'orchestration';

export const NEEDS_YOU_PREFIX = 'Needs you: ';

export function needsYouLine(reason: string): string {
  return `${NEEDS_YOU_PREFIX}${reason}`;
}

export function needsYouLines(reply: string): string[] {
  return reply
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(NEEDS_YOU_PREFIX));
}
