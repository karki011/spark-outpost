import { z } from 'zod';
import { analyticsWindowSchema, verdictCountsSchema } from './analytics.ts';
import { buildStyleSchema } from './lean.ts';
import { outcomeVerdictSchema } from './outcomes.ts';

const count = z.number().int().nonnegative();

export const FLOW_STAGES = ['category', 'depth', 'crew', 'model', 'outcome'] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];

export const flowPathSchema = z.object({
  category: z.string(),
  depth: z.string(),
  crew: z.string(),
  model: z.string(),
  provider: z.string(),
  outcome: z.string(),
  turns: z.number().int().positive(),
});
export type FlowPath = z.infer<typeof flowPathSchema>;

export const gateDecisionPointSchema = z.enum(['act', 'ask', 'fallback']);

export const confidencePointSchema = z.object({
  confidence: z.number().min(0).max(1),
  score: z.number().min(-1).max(1).nullable(),
  verdict: outcomeVerdictSchema,
  decision: gateDecisionPointSchema.nullable(),
  actAt: z.number().nullable(),
});
export type ConfidencePoint = z.infer<typeof confidencePointSchema>;

export const outcomeTallySchema = verdictCountsSchema.extend({
  turns: count,
  meanScore: z.number().nullable(),
});
export type OutcomeTally = z.infer<typeof outcomeTallySchema>;

export const disagreementWinnerSchema = z.enum(['jev', 'rules', 'tie', 'not_enough']);
export type DisagreementWinner = z.infer<typeof disagreementWinnerSchema>;

export const disagreementRowSchema = z.object({
  field: z.string(),
  rulePick: z.string(),
  jevPick: z.string(),
  turns: count,
  jevRan: outcomeTallySchema,
  rulesRan: outcomeTallySchema,
  asked: count,
  winner: disagreementWinnerSchema,
});
export type DisagreementRow = z.infer<typeof disagreementRowSchema>;

export const agreementKeySchema = z.enum(['same', 'differs', 'no_jev']);
export type AgreementKey = z.infer<typeof agreementKeySchema>;

export const agreementRowSchema = outcomeTallySchema.extend({ key: agreementKeySchema });
export type AgreementRow = z.infer<typeof agreementRowSchema>;

export const leanRowSchema = outcomeTallySchema.extend({
  style: buildStyleSchema,
  kept: count,
  meanCostUsd: z.number().nonnegative().nullable(),
  netLines: z.number().int().nonpositive(),
});
export type LeanRow = z.infer<typeof leanRowSchema>;

export const criticSummarySchema = z.object({
  reviews: count,
  concerns: count,
  looksGood: count,
  unclear: count,
  findings: count,
  reviewed: outcomeTallySchema,
  unreviewed: outcomeTallySchema,
});
export type CriticSummary = z.infer<typeof criticSummarySchema>;

export const checkSummarySchema = z.object({
  turns: count,
  firstPassed: count,
  finalPassed: count,
  fixLoops: count,
  rounds: count,
});
export type CheckSummary = z.infer<typeof checkSummarySchema>;

export const loopSummarySchema = z.object({
  turns: count,
  withRetries: count,
  retries: count,
  fixLoops: count,
});
export type LoopSummary = z.infer<typeof loopSummarySchema>;

export const approvalKindWaitSchema = z.object({
  kind: z.string(),
  count,
  medianMs: z.number().int().nonnegative().nullable(),
  p90Ms: z.number().int().nonnegative().nullable(),
});
export type ApprovalKindWait = z.infer<typeof approvalKindWaitSchema>;

export const routingCostRowSchema = z.object({
  key: agreementKeySchema,
  turns: count,
  verified: count,
  costUsd: z.number().nonnegative(),
  costPerVerifiedUsd: z.number().nonnegative().nullable(),
});
export type RoutingCostRow = z.infer<typeof routingCostRowSchema>;

export const observationRowSchema = z.object({
  would: z.string(),
  actual: z.string(),
  count,
});
export type ObservationRow = z.infer<typeof observationRowSchema>;

export const observationSummarySchema = z.object({
  checks: count,
  skipped: count,
  rows: z.array(observationRowSchema),
});
export type ObservationSummary = z.infer<typeof observationSummarySchema>;

export const analyticsHarnessSchema = z.object({
  window: analyticsWindowSchema,
  turns: count,
  flow: z.array(flowPathSchema),
  confidence: z.array(confidencePointSchema),
  disagreements: z.array(disagreementRowSchema),
  agreement: z.array(agreementRowSchema),
  lean: z.array(leanRowSchema),
  critic: criticSummarySchema,
  checks: checkSummarySchema,
  loops: loopSummarySchema,
  approvals: z.object({
    count,
    medianMs: z.number().int().nonnegative().nullable(),
    byKind: z.array(approvalKindWaitSchema),
  }),
  routingCost: z.array(routingCostRowSchema).default([]),
  observation: z
    .object({ policy: observationSummarySchema, verify: observationSummarySchema })
    .default({
      policy: { checks: 0, skipped: 0, rows: [] },
      verify: { checks: 0, skipped: 0, rows: [] },
    }),
});
export type AnalyticsHarness = z.infer<typeof analyticsHarnessSchema>;

export const GATE_LINES = [{ at: 0.9, label: 'Tier act line (observed only)' }] as const;
