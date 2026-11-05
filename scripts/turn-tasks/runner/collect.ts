import type { Db } from '../../../apps/server/src/persistence/db.ts';
import { estimateCostUsd } from '../../../apps/server/src/usage/prices.ts';
import { modelCalls } from '../rows/model-calls.ts';
import { reviewMarks } from '../rows/review-marks.ts';
import { commandRows, outputEvents, protocolRows, runOutcomes } from '../rows/rows.ts';
import { toolCallFacts } from '../rows/tool-calls.ts';
import type { LogRow } from '../rows/types.ts';
import type { AuditFacts } from '../tasks/types.ts';
import { agentErrorsIn, failureOf, type Failure } from './failure.ts';
import { metricsOf, type AuditCounts, type Estimate, type Metrics } from './metrics.ts';
import { approvalReasons, traceOf, type RunTrace } from './trace.ts';
import { agentUsage } from './usage.ts';

export interface Collected {
  metrics: Metrics;
  audit: AuditFacts;
  reply: string;
  runIds: string[];
  failure: Failure | null;
  trace?: RunTrace;
}

export async function runIdsOf(db: Db, runId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM runs WHERE id = $1 OR parent_run_id = $1 ORDER BY created_at',
    [runId],
  );
  return rows.map((row) => row.id);
}

async function statusOf(db: Db, runId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [
    runId,
  ]);
  return rows[0]?.status ?? 'unknown';
}

async function auditCounts(db: Db, ids: string[], rows: readonly LogRow[]): Promise<AuditCounts> {
  const marks = reviewMarks(rows);
  const flags = await db.query<{ count: string }>(
    'SELECT count(*) FROM rail_flags WHERE run_id = ANY($1)',
    [ids],
  );
  return {
    modelCalls: modelCalls(rows).length,
    ranWithoutReview: marks.other.length,
    sparkToolMarks: marks.sparkTools,
    railFlags: Number(flags.rows[0]?.count ?? 0),
  };
}

export async function auditFacts(db: Db, ids: string[]): Promise<AuditFacts> {
  const approvals = await db.query<{
    run_id: string;
    tool_call_id: string;
    kind: string;
    title: string;
    text: string;
    status: string;
    decided_by: string | null;
  }>(
    `SELECT run_id, tool_call_id, kind, title, payload::text AS text, status, decided_by
     FROM approvals WHERE run_id = ANY($1) ORDER BY created_at`,
    [ids],
  );
  const flags = await db.query<{ rail: string }>(
    'SELECT rail FROM rail_flags WHERE run_id = ANY($1) ORDER BY created_at',
    [ids],
  );
  const rows = await protocolRows(db, ids);
  const counts = await auditCounts(db, ids, rows);
  return {
    calls: toolCallFacts(rows),
    approvals: approvals.rows.map((row) => ({
      runId: row.run_id,
      toolCallId: row.tool_call_id,
      kind: row.kind,
      title: row.title,
      text: row.text,
      status: row.status,
      decidedBy: row.decided_by,
    })),
    railFlags: flags.rows.map((row) => row.rail),
    unreviewed: counts.ranWithoutReview,
  };
}

async function replyOf(db: Db, runId: string): Promise<string> {
  const saved = await db.query<{ content: string }>(
    `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`,
    [runId],
  );
  if (saved.rows[0]) return saved.rows[0].content;
  const streamed = await db.query<{ text: string | null }>(
    `SELECT string_agg(payload->>'delta', '' ORDER BY seq) AS text FROM run_events
     WHERE run_id = $1 AND type = 'TEXT_MESSAGE_CONTENT'`,
    [runId],
  );
  return streamed.rows[0]?.text ?? '';
}

const listPrice: Estimate = (model, agent) =>
  estimateCostUsd(agent.provider, model, {
    input: agent.inputTokens,
    output: agent.outputTokens,
    cachedRead: agent.cachedReadTokens,
  });

export async function collectRun(db: Db, runId: string, wallMs: number): Promise<Collected> {
  const runIds = await runIdsOf(db, runId);
  const audit = await auditFacts(db, runIds);
  const rows = await protocolRows(db, runIds);
  const counts = await auditCounts(db, runIds, rows);
  const agents = await agentUsage(db, runId);
  const status = await statusOf(db, runId);
  const reply = await replyOf(db, runId);
  const refusals = agentErrorsIn(rows);
  const trace = traceOf({
    reply,
    agents,
    audit,
    reasons: await approvalReasons(db, runIds),
    commands: await commandRows(db, runIds),
    outputs: await outputEvents(db, runIds),
  });
  return {
    trace,
    metrics: metricsOf(status, wallMs, agents, counts, audit.approvals, listPrice),
    audit,
    reply,
    runIds,
    failure: failureOf(await runOutcomes(db, runIds), refusals, reply),
  };
}
