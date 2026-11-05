import { z } from 'zod';
import { runModeSchema } from './approvals.ts';
import { categorySchema } from './categories.ts';
import { routeSourceSchema } from './checkpoints.ts';
import { modelTierSchema } from './model-cards.ts';

export const protocolDirectionSchema = z.enum(['to_agent', 'from_agent', 'harness']);
export type ProtocolDirection = z.infer<typeof protocolDirectionSchema>;

export const protocolEntryKindSchema = z.enum([
  'request',
  'response',
  'error',
  'notification',
  'stderr',
  'check',
  'ship',
  'revert',
]);
export type ProtocolEntryKind = z.infer<typeof protocolEntryKindSchema>;

export const costSourceSchema = z.enum(['reported', 'estimated']);
export type CostSource = z.infer<typeof costSourceSchema>;

export const totalCostSourceSchema = z.enum(['reported', 'estimated', 'mixed']);
export type TotalCostSource = z.infer<typeof totalCostSourceSchema>;

export function mergeCostSource(
  current: TotalCostSource | null,
  next: TotalCostSource | null,
): TotalCostSource | null {
  if (next === null) return current;
  if (current === null || current === next) return next;
  return 'mixed';
}

export const protocolLogEntrySchema = z.object({
  runId: z.uuid(),
  seq: z.number().int().positive(),
  at: z.string(),
  direction: protocolDirectionSchema,
  kind: protocolEntryKindSchema,
  method: z.string().nullable(),
  rpcId: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  payload: z.unknown(),
  prevHash: z.string().nullable(),
  hash: z.string(),
  unreviewed: z.boolean().optional(),
});
export type ProtocolLogEntry = z.infer<typeof protocolLogEntrySchema>;

export const AUDIT_LOG_MAX_LIMIT = 500;

export const auditLogQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(AUDIT_LOG_MAX_LIMIT).default(100),
  direction: protocolDirectionSchema.optional(),
  method: z.string().min(1).max(200).optional(),
  q: z.string().min(1).max(200).optional(),
  subagent: z.string().min(1).max(200).optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogPageSchema = z.object({
  entries: z.array(protocolLogEntrySchema),
  nextAfter: z.number().int().nullable(),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

export const chainVerificationSchema = z.object({
  runId: z.uuid(),
  intact: z.boolean(),
  checked: z.number().int().nonnegative(),
  firstBrokenSeq: z.number().int().nullable(),
  reason: z.string().nullable(),
  pruned: z.boolean(),
});
export type ChainVerification = z.infer<typeof chainVerificationSchema>;

const count = z.number().int().nonnegative();

export const auditTotalsSchema = z.object({
  runs: count,
  inputTokens: count,
  outputTokens: count,
  cachedReadTokens: count,
  cachedWriteTokens: count,
  thoughtTokens: count,
  totalTokens: count,
  costUsd: z.number().nullable(),
  costSource: totalCostSourceSchema.nullable(),
  toolCalls: count,
  durationMs: count,
});
export type AuditTotals = z.infer<typeof auditTotalsSchema>;

export const approvalWaitSchema = z.object({
  start: z.string(),
  end: z.string().nullable(),
  auto: z.boolean().optional(),
});
export type ApprovalWait = z.infer<typeof approvalWaitSchema>;

export const auditRunRouteSchema = z.object({
  routedBy: routeSourceSchema,
  rule: z.string().nullable(),
  tier: modelTierSchema.nullable(),
});
export type AuditRunRoute = z.infer<typeof auditRunRouteSchema>;

export const auditRunSummarySchema = z.object({
  runId: z.uuid(),
  userMessageId: z.uuid().nullable(),
  provider: z.string(),
  role: z.string(),
  runMode: runModeSchema.nullable(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  mode: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  approvalWaits: z.array(approvalWaitSchema),
  durationMs: z.number().int().nullable(),
  toolCallCount: z.number().int().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  cachedReadTokens: z.number().int().nullable(),
  cachedWriteTokens: z.number().int().nullable(),
  thoughtTokens: z.number().int().nullable(),
  totalTokens: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  costSource: costSourceSchema.nullable(),
  logEntries: count,
  logPruned: z.boolean(),
  methods: z.array(z.string()),
  parentRunId: z.uuid().nullable().optional(),
  agentLabel: z.string().nullable().optional(),
  category: categorySchema.nullable().optional(),
  fileReads: z.number().int().nullable().optional(),
  unreviewedCount: count.optional(),
  route: auditRunRouteSchema.optional(),
});
export type AuditRunSummary = z.infer<typeof auditRunSummarySchema>;

export const auditSummarySchema = z.object({
  conversationId: z.uuid(),
  totals: auditTotalsSchema,
  byProvider: z.array(auditTotalsSchema.extend({ provider: z.string() })),
  byModel: z.array(
    auditTotalsSchema.extend({ provider: z.string(), model: z.string().nullable() }),
  ),
  runs: z.array(auditRunSummarySchema),
  byRole: z.array(auditTotalsSchema.extend({ role: z.string() })).optional(),
  orchestrations: z
    .array(
      z.object({
        runId: z.uuid(),
        totals: auditTotalsSchema,
        byRole: z.array(auditTotalsSchema.extend({ role: z.string() })),
        byModel: z.array(
          auditTotalsSchema.extend({ provider: z.string(), model: z.string().nullable() }),
        ),
      }),
    )
    .optional(),
});
export type AuditSummary = z.infer<typeof auditSummarySchema>;

export const auditExportLineSchema = z.discriminatedUnion('type', [
  auditRunSummarySchema.extend({ type: z.literal('run') }),
  protocolLogEntrySchema.extend({ type: z.literal('log') }),
]);
export type AuditExportLine = z.infer<typeof auditExportLineSchema>;
