import type { Orchestration } from '../../packages/contracts/src/index.ts';
import type { Db } from '../../apps/server/src/persistence/db.ts';
import { architectRecord, intakeRecord, parallelRecord } from './decision-records.ts';
import type { AgentUsage, Routing } from './results.ts';

interface UsageRow {
  id: string;
  parent_run_id: string | null;
  role: string | null;
  name: string | null;
  provider: string;
  model: string | null;
  effort: string | null;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
  cost_usd: string | null;
  cost_source: string | null;
  duration_ms: number | null;
  tool_call_count: number | null;
  parallel_group: string | null;
}

function toUsage(row: UsageRow): AgentUsage {
  return {
    role: row.role ?? 'agent',
    name: row.name,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    status: row.status,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    cachedReadTokens: row.cached_read_tokens ?? 0,
    cachedWriteTokens: row.cached_write_tokens ?? 0,
    costUsd: Number(row.cost_usd ?? 0),
    costSource: row.cost_source,
    durationMs: row.duration_ms ?? 0,
    toolCalls: row.tool_call_count ?? 0,
    parallelGroup: row.parallel_group,
  };
}

export async function agentUsage(db: Db, runId: string): Promise<AgentUsage[]> {
  const { rows } = await db.query<UsageRow>(
    `SELECT id, parent_run_id, role, route->>'name' AS name, provider,
       COALESCE(used_model, model) AS model, COALESCE(used_effort, effort) AS effort, status,
       input_tokens, output_tokens, cached_read_tokens, cached_write_tokens, cost_usd,
       cost_source, duration_ms, tool_call_count, route->>'parallelGroup' AS parallel_group
     FROM runs WHERE id = $1 OR parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  const children = rows.filter((row) => row.parent_run_id === runId);
  return (children.length > 0 ? children : rows).map(toUsage);
}

export function routingOf(orchestration: Orchestration | null): Routing | null {
  if (!orchestration) return null;
  return {
    depth: orchestration.depth,
    depthSource: orchestration.depthSource,
    risk: orchestration.risk,
    decisions: orchestration.decisions.map((decision) => ({
      kind: decision.kind,
      role: decision.role,
      summary: decision.summary,
      applied: decision.applied,
      confidence: decision.gate?.confidence ?? null,
      jevStatus: decision.jevStatus,
      costUsd: decision.costUsd,
    })),
    intake: intakeRecord(orchestration),
    architect: architectRecord(orchestration),
    parallel: parallelRecord(orchestration),
  };
}
