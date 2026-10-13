import type {
  CostSource,
  NativeTerminalProvider,
  NativeTerminalTurn,
  NativeTerminalUsage,
  RunStatus,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { nativeStepsByRun } from './native-terminal-steps.ts';

interface TurnRow {
  id: string;
  status: RunStatus;
  created_at: Date;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
  thought_tokens: number | null;
  cost_usd: string | null;
  cost_source: CostSource | null;
}

function turnTokens(row: TurnRow): NativeTerminalTurn['tokens'] {
  if (row.input_tokens === null || row.output_tokens === null) return null;
  return {
    input: row.input_tokens,
    output: row.output_tokens,
    total: row.total_tokens ?? row.input_tokens + row.output_tokens,
    cachedRead: row.cached_read_tokens,
    cachedWrite: row.cached_write_tokens,
    thought: row.thought_tokens,
  };
}

export async function nativeTerminalUsage(
  db: Queryable,
  conversationId: string,
): Promise<NativeTerminalUsage> {
  const [session, runs, steps] = await Promise.all([
    db.query<{ provider: NativeTerminalProvider }>(
      'SELECT provider FROM native_terminal_sessions WHERE conversation_id = $1',
      [conversationId],
    ),
    db.query<TurnRow>(
      `SELECT r.id, r.status, r.created_at, r.used_model AS model, r.input_tokens, r.output_tokens,
         r.total_tokens, r.cached_read_tokens, r.cached_write_tokens, r.thought_tokens,
         r.cost_usd::text AS cost_usd, r.cost_source
       FROM runs r JOIN conversations c ON c.id = r.conversation_id
       WHERE r.conversation_id = $1 AND c.session_type = 'terminal' AND r.parent_run_id IS NULL
       ORDER BY r.created_at`,
      [conversationId],
    ),
    nativeStepsByRun(db, conversationId),
  ]);
  return {
    provider: session.rows[0]?.provider ?? null,
    turns: runs.rows.map((row) => ({
      runId: row.id,
      startedAt: row.created_at.toISOString(),
      status: row.status,
      model: row.model,
      tokens: turnTokens(row),
      costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      costSource: row.cost_usd === null ? null : row.cost_source,
      steps: steps.get(row.id) ?? [],
    })),
  };
}
