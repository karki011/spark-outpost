import { z } from 'zod';
import { auditExportLineSchema } from './audit.ts';

export const harnessSettingSchema = z.enum(['current', 'simple']);
export type HarnessSetting = z.infer<typeof harnessSettingSchema>;

export const DECISION_EXPORT_VERSION = 2;

export const sessionEventKindSchema = z.enum([
  'open',
  'resume',
  'replace',
  'model_change',
  'close',
]);
export type SessionEventKind = z.infer<typeof sessionEventKindSchema>;

export const sessionEventSchema = z.object({
  event: sessionEventKindSchema,
  reason: z.string().nullable(),
  kept: z.boolean(),
  harness: harnessSettingSchema.optional(),
  provider: z.string(),
  agentKey: z.string().nullable(),
  sessionId: z.string().nullable(),
  model: z.string().nullable(),
  fromModel: z.string().nullable().optional(),
  mode: z.string().nullable().optional(),
  fromMode: z.string().nullable().optional(),
  carriedTokens: z.number().int().nonnegative().nullable(),
  cacheWriteUsd: z.number().nonnegative().nullable(),
  handoff: z.boolean().optional(),
});
export type SessionEvent = z.infer<typeof sessionEventSchema>;

const money = z.number().nonnegative().nullable();
const count = z.number().int().nonnegative();

export const costSplitSchema = z.object({
  totalUsd: money,
  inputUsd: money,
  cacheWriteUsd: money,
  cacheReadUsd: money,
  outputUsd: money,
  source: z.enum(['estimated', 'unpriced']),
});
export type CostSplit = z.infer<typeof costSplitSchema>;

export const decisionMetaLineSchema = z.object({
  type: z.literal('meta'),
  exportVersion: z.literal(DECISION_EXPORT_VERSION),
  conversationId: z.uuid(),
  exportedAt: z.string(),
  appVersion: z.string().nullable(),
  harness: harnessSettingSchema,
  messageText: z.enum(['redacted', 'lengths_only']),
});

export const turnLineSchema = z.object({
  type: z.literal('turn'),
  userMessageId: z.uuid().nullable(),
  at: z.string(),
  messageChars: count,
  messageText: z.string().nullable(),
  replyChars: count.nullable(),
  status: z.string(),
  runs: count,
  sessions: z.object({ opened: count, resumed: count, replaced: count, modelChanges: count }),
  repeatRuns: count,
  escalations: count,
  jevCalls: count,
  cards: count,
  minutesWaited: z.number().nonnegative(),
  tiers: z.array(z.string()),
  cost: costSplitSchema,
});
export type TurnLine = z.infer<typeof turnLineSchema>;

export const runEndLineSchema = z.object({
  type: z.literal('run_end'),
  runId: z.uuid(),
  userMessageId: z.uuid().nullable(),
  role: z.string().nullable(),
  attempt: count.nullable(),
  status: z.string(),
  endReason: z.string().nullable(),
  error: z.string().nullable(),
  errorDetails: z.string().nullable(),
  tier: z.string().nullable(),
  cost: costSplitSchema,
});
export type RunEndLine = z.infer<typeof runEndLineSchema>;

export const sessionLineSchema = sessionEventSchema.extend({
  type: z.literal('session'),
  runId: z.uuid().nullable(),
  userMessageId: z.uuid().nullable(),
  at: z.string(),
});
export type SessionLine = z.infer<typeof sessionLineSchema>;

export const jevBandSchema = z.enum(['act', 'unsure', 'no']);
export type JevBand = z.infer<typeof jevBandSchema>;

export const jevLineSchema = z.object({
  type: z.literal('jev'),
  runId: z.uuid(),
  childRunId: z.uuid().nullable(),
  userMessageId: z.uuid().nullable(),
  at: z.string(),
  purpose: z.string(),
  status: z.string(),
  model: z.string().nullable(),
  policyVersion: z.string().nullable(),
  questions: z.array(z.object({ id: z.string(), type: z.string().nullable() })),
  stateChars: count,
  answers: z.unknown(),
  confidence: z.number().nullable(),
  band: jevBandSchema.nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  inputTokens: count.nullable(),
  costUsd: money,
  applied: z.string().nullable(),
  fallbackReason: z.string().nullable(),
});
export type JevLine = z.infer<typeof jevLineSchema>;

export const cardLineSchema = z.object({
  type: z.literal('card'),
  runId: z.uuid(),
  userMessageId: z.uuid().nullable(),
  kind: z.string(),
  title: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  decidedBy: z.string().nullable(),
  option: z.string().nullable(),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  minutesWaited: z.number().nonnegative(),
  shown: z.boolean(),
});
export type CardLine = z.infer<typeof cardLineSchema>;

export const decisionLineSchema = z.discriminatedUnion('type', [
  decisionMetaLineSchema,
  turnLineSchema,
  runEndLineSchema,
  sessionLineSchema,
  jevLineSchema,
  cardLineSchema,
]);
export type DecisionLine = z.infer<typeof decisionLineSchema>;

export const auditFileLineSchema = z.union([auditExportLineSchema, decisionLineSchema]);
export type AuditFileLine = z.infer<typeof auditFileLineSchema>;
