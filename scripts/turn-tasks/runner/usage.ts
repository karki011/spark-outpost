import type { Db } from '../../../apps/server/src/persistence/db.ts';

export interface AgentUsage {
  provider: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  costUsd: number;
  costSource: string | null;
  durationMs: number;
  toolCalls: number;
}

interface UsageRow {
  provider: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_read_tokens: number | null;
  cost_usd: string | null;
  cost_source: string | null;
  duration_ms: number | null;
  tool_call_count: number | null;
}

export async function agentUsage(db: Db, runId: string): Promise<AgentUsage[]> {
  const { rows } = await db.query<UsageRow>(
    `SELECT provider, COALESCE(used_model, model) AS model, input_tokens, output_tokens,
       cached_read_tokens, cost_usd, cost_source, duration_ms, tool_call_count
     FROM runs WHERE id = $1 OR parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    cachedReadTokens: row.cached_read_tokens ?? 0,
    costUsd: Number(row.cost_usd ?? 0),
    costSource: row.cost_source,
    durationMs: row.duration_ms ?? 0,
    toolCalls: row.tool_call_count ?? 0,
  }));
}
