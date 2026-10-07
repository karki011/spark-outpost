import { z } from 'zod';
import {
  agentRoleSchema,
  auditRunRouteSchema,
  categorySchema,
  agentRoleLabel,
  mergeCostSource,
  runRole,
  type ApprovalWait,
  type AuditRunRoute,
  type AuditRunSummary,
  type AuditSummary,
  type AuditTotals,
  type CostSource,
  type RunMode,
} from '@spark-outpost/contracts';
import { groupBy } from '../analytics/tally.ts';
import type { Queryable } from './db.ts';

interface RunAuditRow {
  id: string;
  parent_run_id: string | null;
  agent_role: string | null;
  agent_label: string | null;
  has_children: boolean;
  user_message_id: string;
  provider: string;
  run_mode: RunMode | null;
  model: string | null;
  effort: string | null;
  mode: string | null;
  status: string;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
  tool_call_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
  thought_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  cost_source: CostSource | null;
  log_pruned: boolean;
  log_entries: number;
  unreviewed_count: number;
  methods: string[];
  category: string | null;
  file_reads: number | null;
  route: unknown;
}

interface WaitRow {
  run_id: string;
  created_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
}

const storedAuditRouteSchema = z.object({
  routedBy: auditRunRouteSchema.shape.routedBy,
  rule: z.string().nullable().catch(null).default(null),
  tier: auditRunRouteSchema.shape.tier.catch(null).default(null),
  autoWouldUse: auditRunRouteSchema.shape.autoWouldUse.catch(null).default(null),
  escalation: auditRunRouteSchema.shape.escalation.catch(undefined),
});

function auditRoute(stored: unknown): AuditRunRoute | null {
  const parsed = storedAuditRouteSchema.safeParse(stored);
  if (!parsed.success) return null;
  const { escalation, ...route } = parsed.data;
  return escalation ? { ...route, escalation } : route;
}

function toRunSummary(row: RunAuditRow, approvalWaits: ApprovalWait[]): AuditRunSummary {
  const route = auditRoute(row.route);
  return {
    runId: row.id,
    userMessageId: row.user_message_id,
    provider: row.provider,
    role: roleOf(row),
    runMode: row.run_mode,
    model: row.model,
    effort: row.effort,
    mode: row.mode,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    approvalWaits,
    durationMs: row.duration_ms,
    toolCallCount: row.tool_call_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedReadTokens: row.cached_read_tokens,
    cachedWriteTokens: row.cached_write_tokens,
    thoughtTokens: row.thought_tokens,
    totalTokens: row.total_tokens,
    costUsd: row.cost_usd,
    costSource: row.cost_source,
    logEntries: row.log_entries,
    logPruned: row.log_pruned,
    methods: row.methods,
    parentRunId: row.parent_run_id,
    agentLabel: row.agent_label,
    category: categorySchema.safeParse(row.category).data ?? null,
    ...(row.file_reads === null ? {} : { fileReads: row.file_reads }),
    ...(row.unreviewed_count > 0 ? { unreviewedCount: row.unreviewed_count } : {}),
    ...(route ? { route } : {}),
  };
}

const ORCHESTRATION_ROLE = 'Orchestration';

function roleOf(row: RunAuditRow): string {
  const role = agentRoleSchema.safeParse(row.agent_role);
  if (role.success) return agentRoleLabel(role.data);
  if (row.agent_role === 'digest') return 'Digest';
  return row.has_children ? ORCHESTRATION_ROLE : runRole(row.run_mode);
}

async function approvalWaits(
  db: Queryable,
  runIds: readonly string[],
): Promise<Map<string, ApprovalWait[]>> {
  const { rows } = await db.query<WaitRow>(
    `SELECT run_id, created_at, decided_at, decided_by FROM approvals
     WHERE run_id = ANY($1::uuid[])
       AND (decided_by IS NULL OR decided_by IN ('user', 'stop', 'timeout', 'recovery', 'auto'))
     ORDER BY created_at`,
    [runIds],
  );
  const byRun = new Map<string, ApprovalWait[]>();
  for (const row of rows) {
    const waits = byRun.get(row.run_id) ?? [];
    waits.push({
      start: row.created_at.toISOString(),
      end: row.decided_at?.toISOString() ?? null,
      auto: row.decided_by === 'auto',
    });
    byRun.set(row.run_id, waits);
  }
  return byRun;
}

export async function conversationAuditRuns(
  db: Queryable,
  conversationId: string,
): Promise<AuditRunSummary[] | null> {
  const exists = await db.query('SELECT 1 FROM conversations WHERE id = $1', [conversationId]);
  if (exists.rowCount === 0) return null;
  const { rows } = await db.query<RunAuditRow>(
    `SELECT r.id, r.parent_run_id, r.role AS agent_role, r.agent_label,
       EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = r.id) AS has_children,
       r.user_message_id, r.provider, r.mode AS run_mode, COALESCE(r.used_model, r.model) AS model,
       COALESCE(r.used_effort, r.effort) AS effort, r.used_mode AS mode, r.status, r.created_at,
       r.started_at, r.finished_at, r.duration_ms, r.tool_call_count, r.input_tokens, r.output_tokens, r.cached_read_tokens,
       r.cached_write_tokens, r.thought_tokens,
       COALESCE(r.total_tokens, r.input_tokens + r.output_tokens) AS total_tokens,
       r.cost_usd::float8 AS cost_usd, r.cost_source,
       (r.route->>'fileReads')::int AS file_reads, r.route,
       r.protocol_log_pruned_at IS NOT NULL AS log_pruned,
       (SELECT count(*)::int FROM run_protocol_log l WHERE l.run_id = r.id) AS log_entries,
       (SELECT count(*)::int FROM run_protocol_log l
         WHERE l.run_id = r.id AND l.unreviewed) AS unreviewed_count,
       ARRAY(SELECT DISTINCT l.method FROM run_protocol_log l
         WHERE l.run_id = r.id AND l.method IS NOT NULL ORDER BY l.method) AS methods,
       COALESCE(p.category, r.category) AS category
     FROM runs r LEFT JOIN runs p ON p.id = r.parent_run_id
     WHERE r.conversation_id = $1
     ORDER BY r.created_at, r.id`,
    [conversationId],
  );
  const waits = await approvalWaits(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toRunSummary(row, waits.get(row.id) ?? []));
}

function auditTotals(runs: readonly AuditRunSummary[]): AuditTotals {
  const totals: AuditTotals = {
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    thoughtTokens: 0,
    totalTokens: 0,
    costUsd: null,
    costSource: null,
    toolCalls: 0,
    durationMs: 0,
  };
  for (const run of runs) {
    totals.runs += 1;
    totals.inputTokens += run.inputTokens ?? 0;
    totals.outputTokens += run.outputTokens ?? 0;
    totals.cachedReadTokens += run.cachedReadTokens ?? 0;
    totals.cachedWriteTokens += run.cachedWriteTokens ?? 0;
    totals.thoughtTokens += run.thoughtTokens ?? 0;
    totals.totalTokens += run.totalTokens ?? 0;
    totals.toolCalls += run.toolCallCount ?? 0;
    totals.durationMs += run.durationMs ?? 0;
    if (run.costUsd !== null) {
      totals.costUsd = (totals.costUsd ?? 0) + run.costUsd;
      totals.costSource = mergeCostSource(totals.costSource, run.costSource ?? 'reported');
    }
  }
  return totals;
}

function groupsOf<T>(items: readonly T[], key: (item: T) => string): T[][] {
  return [...groupBy(items, key).values()];
}

export function summarizeAudit(
  conversationId: string,
  runs: readonly AuditRunSummary[],
): AuditSummary {
  return {
    conversationId,
    totals: auditTotals(runs),
    byProvider: groupsOf(runs, (run) => run.provider).map((group) => ({
      provider: group[0]!.provider,
      ...auditTotals(group),
    })),
    byModel: byModel(runs),
    runs: [...runs],
    byRole: byRole(runs),
    orchestrations: orchestrationTotals(runs),
  };
}

function byRole(runs: readonly AuditRunSummary[]) {
  return groupsOf(runs, (run) => run.role).map((group) => ({
    role: group[0]!.role,
    ...auditTotals(group),
  }));
}

function byModel(runs: readonly AuditRunSummary[]) {
  return groupsOf(runs, (run) => JSON.stringify([run.provider, run.model])).map((group) => ({
    provider: group[0]!.provider,
    model: group[0]!.model,
    ...auditTotals(group),
  }));
}

function orchestrationTotals(runs: readonly AuditRunSummary[]) {
  const parents = runs.filter((run) => runs.some((child) => child.parentRunId === run.runId));
  return parents.map((parent) => {
    const members = runs.filter(
      (run) =>
        run.parentRunId === parent.runId ||
        (run.runId === parent.runId && run.role !== ORCHESTRATION_ROLE),
    );
    return {
      runId: parent.runId,
      totals: auditTotals(members),
      byRole: byRole(members),
      byModel: byModel(members),
    };
  });
}
