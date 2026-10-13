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

interface ReportedRow {
  cost_usd: string;
  models: NativeTerminalReportedModel[];
  updated_at: Date;
}

const REPORTED_COUNTS = ['input', 'output', 'cachedRead', 'cachedWrite', 'thought'] as const;

function addModel(
  known: NativeTerminalReportedModel | undefined,
  next: NativeTerminalReportedModel,
): NativeTerminalReportedModel {
  if (!known) return next;
  const merged = { ...known };
  for (const key of REPORTED_COUNTS) merged[key] += next[key];
  merged.costUsd =
    known.costUsd === null || next.costUsd === null ? null : known.costUsd + next.costUsd;
  return merged;
}

export function reportedTotal(rows: readonly ReportedRow[]): NativeTerminalReported | null {
  if (rows.length === 0) return null;
  const models = new Map<string, NativeTerminalReportedModel>();
  for (const row of rows)
    for (const model of row.models)
      models.set(model.model, addModel(models.get(model.model), model));
  const cents = rows.reduce(
    (total, row) => total + Math.round(Number(row.cost_usd) * 1_000_000),
    0,
  );
  return {
    costUsd: cents / 1_000_000,
    cliSessions: rows.length,
    models: [...models.values()],
    updatedAt: new Date(Math.max(...rows.map((row) => row.updated_at.getTime()))).toISOString(),
  };
}

export async function nativeTerminalUsage(
  db: Queryable,
  conversationId: string,
): Promise<NativeTerminalUsage> {
  const [session, runs, steps, reported] = await Promise.all([
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
    db.query<ReportedRow>(
      `SELECT u.cost_usd::text AS cost_usd, u.models, u.updated_at
       FROM native_terminal_reported_usage u
       JOIN native_terminal_sessions s ON s.id = u.session_id
       WHERE s.conversation_id = $1 ORDER BY u.native_session_id`,
      [conversationId],
    ),
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
    reported: reportedTotal(reported.rows),
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
     WHERE id = $1`,
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
