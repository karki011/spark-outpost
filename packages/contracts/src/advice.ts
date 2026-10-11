import { z } from 'zod';
import { involvementLevelSchema } from './involvement-levels.ts';
import { categorySchema, titleOriginSchema, upgradeLegacyCategory } from './categories.ts';

export const intentSchema = z.preprocess(upgradeLegacyCategory, categorySchema);
export const riskSchema = z.enum(['read-only', 'edits', 'multi-file', 'destructive']);
export type Risk = z.infer<typeof riskSchema>;

export const depthSchema = z.enum(['direct', 'execute', 'plan_execute', 'plan_execute_review']);
export type Depth = z.infer<typeof depthSchema>;

export const gateDecisionSchema = z.enum(['act', 'ask', 'fallback']);
export const modelRoutingSchema = z.enum(['pinned', 'auto']);
export type ModelRouting = z.infer<typeof modelRoutingSchema>;

export const jevStatusSchema = z.enum([
  'answered',
  'failed',
  'timed_out',
  'not_connected',
  'not_asked',
]);
export type JevStatus = z.infer<typeof jevStatusSchema>;

export const intakeAnswerSchema = z.object({
  intent: intentSchema.nullable(),
  complexity: z.number().min(0).nullable(),
  risk: riskSchema,
  injection: z.number().min(0).max(1).nullable(),
  depth: depthSchema,
  provider: z.string(),
  model: z.string().nullable(),
  modelLabel: z.string().nullable(),
  effort: z.string().nullable(),
});
export const scopeSchema = z.enum(['one_spot', 'one_module', 'few_modules', 'codebase']);
export const routeTierSchema = z.enum(['small', 'mid', 'top']);
const noul = z.number().min(0).max(1);

export const ratingSchema = z.object({
  value: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
});
export const ratingsSchema = z.object({
  complexity: ratingSchema.optional(),
  ambiguity: ratingSchema.optional(),
  stakes: ratingSchema.optional(),
  contextDependence: ratingSchema.optional(),
});
export const jevIntakeSchema = intakeAnswerSchema.extend({
  scope: scopeSchema.nullable().optional(),
  reviewExisting: noul.optional(),
  vague: noul.optional(),
  mechanical: noul.optional(),
  question: noul.optional(),
  plan: noul.optional(),
  planOnly: noul.optional(),
  review: noul.optional(),
  destructive: noul.optional(),
  continuesTask: noul.optional(),
  planAgreed: noul.optional(),
  previousIsPlan: noul.optional(),
  tier: routeTierSchema.nullable().optional(),
  need: z
    .object({
      value: z.enum(['question', 'small_change', 'build', 'needs_you']),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
  ratings: ratingsSchema.optional(),
  invalid: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  routeConfidence: z.number().min(0).max(1).nullable(),
  confidences: z.record(z.string(), z.number()),
});
export const gateSchema = z.object({
  decision: gateDecisionSchema,
  confidence: z.number(),
  risk: riskSchema,
  level: involvementLevelSchema,
  actAt: z.number(),
  askAt: z.number(),
  clarifyBelow: z.number().nullable(),
});
export const mechanicalNoteSchema = z.object({
  mechanical: z.boolean(),
  source: z.enum(['jev', 'rules']),
  jev: z.number().min(0).max(1).nullable(),
  rule: z.boolean(),
  summary: z.string(),
});
export const adviceUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  tokenSource: z.enum(['reported', 'estimated']),
  costUsd: z.number().nonnegative(),
  costSource: z.literal('estimated'),
});
export type AdviceUsage = z.infer<typeof adviceUsageSchema>;

export const intakeCallSchema = z.object({
  jev: z.number().min(0).max(1).nullable(),
  rule: z.boolean().nullable(),
  value: z.boolean(),
  source: z.enum(['jev', 'rules', 'user']),
  gate: gateSchema.nullable(),
});
export type IntakeCall = z.infer<typeof intakeCallSchema>;

export const adviceSummarySchema = z.object({
  purpose: z.literal('intake'),
  policyVersion: z.string().optional(),
  calls: z.record(z.string(), intakeCallSchema).optional(),
  notAsked: z.record(z.string(), z.string()).optional(),
  routing: modelRoutingSchema,
  rules: intakeAnswerSchema,
  jev: jevIntakeSchema.nullable(),
  jevStatus: jevStatusSchema,
  jevError: z.string().nullable(),
  jevModel: z.string().nullable(),
  gate: gateSchema.nullable(),
  routeGate: gateSchema.nullable(),
  wouldApply: z.enum(['jev', 'ask', 'rules']),
  differences: z.array(z.string()),
  latencyMs: z.number().int().nonnegative().nullable(),
  usage: adviceUsageSchema.nullable(),
  depthNote: z.object({ depth: depthSchema, reason: z.string() }).nullable().optional(),
  mechanical: mechanicalNoteSchema.nullable().optional(),
  title: z.object({ text: z.string(), origin: titleOriginSchema }).nullable().optional(),
});
export type AdviceSummary = z.infer<typeof adviceSummarySchema>;

export const advisorUsageSchema = z.object({
  advisor: z.string(),
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type AdvisorUsage = z.infer<typeof advisorUsageSchema>;

const DEPTH_LABELS: Record<Depth, string> = {
  direct: 'direct',
  execute: 'execute',
  plan_execute: 'plan → execute',
  plan_execute_review: 'plan → execute → review',
};

export function depthLabel(depth: Depth): string {
  return DEPTH_LABELS[depth];
}

const ADVISOR_LABELS: Record<string, string> = { jev: 'Jev' };

export function advisorLabel(advisor: string): string {
  return ADVISOR_LABELS[advisor] ?? advisor;
}
