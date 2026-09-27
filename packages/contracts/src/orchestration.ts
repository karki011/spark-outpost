import { z } from 'zod';
import {
  depthSchema,
  gateSchema,
  jevStatusSchema,
  modelRoutingSchema,
  riskSchema,
} from './advice.ts';
import { approvalSchema, involvementLevelSchema, runModeSchema } from './approvals.ts';
import { costSourceSchema, totalCostSourceSchema } from './audit.ts';
import { runStatusSchema } from './runs.ts';
import { agentPickSchema, budgetLimitSchema, routeSourceSchema } from './checkpoints.ts';
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
]);
export type DecisionKind = z.infer<typeof decisionKindSchema>;

export const decisionAppliedSchema = z.enum(['jev', 'rules', 'asked', 'pinned']);
export type DecisionApplied = z.infer<typeof decisionAppliedSchema>;

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
  sameProvider: z.boolean().optional(),
});
export type CrewMember = z.infer<typeof crewMemberSchema>;

export const orchestrationBudgetSchema = z.object({
  activeMs: z.number().int().nonnegative(),
  activeLimitMs: z.number().int().positive(),
  toolCalls: z.number().int().nonnegative(),
  toolCallLimit: z.number().int().positive(),
  costUsd: z.number().nonnegative(),
  costCapUsd: z.number().positive().nullable(),
  exceeded: budgetLimitSchema.nullable(),
});
export type OrchestrationBudget = z.infer<typeof orchestrationBudgetSchema>;

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
export const ORCHESTRATION_ACTIVE_LIMIT_MS = 15 * 60 * 1000;
export const ORCHESTRATION_TOOL_CALL_LIMIT = 60;

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
  routing: modelRoutingSchema,
  provider: z.string(),
  planVersion: z.number().int().nullable(),
  retries: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
  crew: z.array(crewMemberSchema),
  checkpoints: z.array(approvalSchema),
  pendingCheckpoint: approvalSchema.nullable(),
  decisions: z.array(orchestrationDecisionSchema),
  budget: orchestrationBudgetSchema,
  totals: orchestrationTotalsSchema,
  error: z.string().nullable(),
  updatedAt: z.string(),
});
export type Orchestration = z.infer<typeof orchestrationSchema>;

export const ORCHESTRATION_ACTIVITY = 'orchestration';
