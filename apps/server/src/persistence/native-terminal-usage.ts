import type {
  CostSource,
  NativeTerminalProvider,
  NativeTerminalReported,
  NativeTerminalReportedModel,
  NativeTerminalTurn,
  NativeTerminalUsage,
  RunStatus,
} from '@spark-outpost/contracts';
import type { Db, Queryable } from './db.ts';
import { nativeStepsByRun, storedLabel } from './native-terminal-steps.ts';
import { promptCacheFor } from './prompt-cache.ts';

export const STOPPED_BY_USER = 'Stopped by the user.';

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
  duration_ms: number | null;
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

interface ReportedRow {
  native_session_id: string;
  cost_usd: string;
  models: NativeTerminalReportedModel[];
  updated_at: Date;
}

function reportedTotals(rows: readonly ReportedRow[]): NativeTerminalReported[] {
  return rows.map((row) => ({
    nativeSessionId: row.native_session_id,
    costUsd: Number(row.cost_usd),
    models: row.models,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function nativeTerminalUsage(
  db: Queryable,
  conversationId: string,
): Promise<NativeTerminalUsage> {
  const [session, runs, steps, reported, promptCache] = await Promise.all([
    db.query<{ provider: NativeTerminalProvider; stopped: boolean }>(
      `SELECT provider, state = 'exited' AND reason = $2 AS stopped
       FROM native_terminal_sessions WHERE conversation_id = $1`,
      [conversationId, STOPPED_BY_USER],
    ),
    db.query<TurnRow>(
      `SELECT r.id, r.status, r.created_at, r.used_model AS model, r.input_tokens, r.output_tokens,
         r.total_tokens, r.cached_read_tokens, r.cached_write_tokens, r.thought_tokens,
         r.cost_usd::text AS cost_usd, r.cost_source,
         (SELECT sum(m.duration_ms)::int FROM native_terminal_mod_turns m
          WHERE m.run_id = r.id AND m.agent_id IS NULL) AS duration_ms
       FROM runs r JOIN conversations c ON c.id = r.conversation_id
       WHERE r.conversation_id = $1 AND c.session_type = 'terminal' AND r.parent_run_id IS NULL
       ORDER BY r.created_at`,
      [conversationId],
    ),
    nativeStepsByRun(db, conversationId),
    db.query<ReportedRow>(
      `SELECT u.native_session_id, u.cost_usd::text AS cost_usd, u.models, u.updated_at
       FROM native_terminal_reported_usage u
       JOIN native_terminal_sessions s ON s.id = u.session_id
       WHERE s.conversation_id = $1 ORDER BY u.created_at, u.native_session_id`,
      [conversationId],
    ),
    promptCacheFor(db, conversationId),
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
      durationMs: row.duration_ms,
      steps: steps.get(row.id) ?? [],
    })),
    reported: reportedTotals(reported.rows),
    stopped: session.rows[0]?.stopped ?? false,
    promptCache,
  };
}

export interface NativeTurnTotals {
  model: string | null;
  tokens: NonNullable<NativeTerminalTurn['tokens']>;
  costUsd: number | null;
}

export async function recordNativeTurnUsage(
  db: Db,
  runId: string,
  { model, tokens, costUsd }: NativeTurnTotals,
): Promise<void> {
  await db.query(
    `UPDATE runs SET input_tokens = $2, output_tokens = $3, total_tokens = $4,
       cached_read_tokens = $5, cached_write_tokens = $6, thought_tokens = $7,
       used_model = COALESCE($8, used_model),
       cost_usd = CASE WHEN cost_source = 'reported' THEN cost_usd ELSE $9::numeric END,
       cost_source = CASE WHEN cost_source = 'reported' THEN cost_source
         WHEN $9::numeric IS NULL THEN NULL ELSE 'estimated' END
     WHERE id = $1 AND NOT EXISTS (
       SELECT 1 FROM native_terminal_mod_turns m
       WHERE m.run_id = $1 AND m.agent_id IS NULL AND m.started_at IS NOT NULL)`,
    [
      runId,
      tokens.input,
      tokens.output,
      tokens.total,
      tokens.cachedRead,
      tokens.cachedWrite,
      tokens.thought,
      model === null ? null : storedLabel(model),
      costUsd,
    ],
  );
}

export interface NativeReportedUsage {
  nativeSessionId: string;
  costUsd: number;
  models: NativeTerminalReportedModel[];
}

export async function recordNativeReportedUsage(
  db: Db,
  sessionId: string,
  usage: NativeReportedUsage,
): Promise<void> {
  await db.query(
    `INSERT INTO native_terminal_reported_usage (session_id, native_session_id, cost_usd, models)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (session_id, native_session_id) DO UPDATE SET
       cost_usd = EXCLUDED.cost_usd, models = EXCLUDED.models, updated_at = now()`,
    [
      sessionId,
      storedLabel(usage.nativeSessionId),
      usage.costUsd,
      JSON.stringify(usage.models.map((entry) => ({ ...entry, model: storedLabel(entry.model) }))),
    ],
  );
}

export async function recordNativeUsageOffset(
  db: Db,
  sessionId: string,
  file: string,
  offset: number,
): Promise<void> {
  await db.query(
    'UPDATE native_terminal_sessions SET usage_file = $2, usage_offset = $3 WHERE id = $1',
    [sessionId, file, offset],
  );
}
