import type { Db, Queryable } from './db.ts';
import type { NativeTurnTotals } from './native-terminal-usage.ts';
import { storedLabel } from './native-terminal-steps.ts';

export interface ModTurnEvent {
  turnId: string;
  agentId: string | null;
  phase: 'start' | 'end';
  at: Date;
  durationMs?: number;
  aborted?: boolean;
}

export interface ModRequest {
  turnId: string;
  index: number;
  agentId: string | null;
  model: string;
  input: number;
  output: number;
  cachedRead: number;
  cachedWrite: number;
  costUsd: number | null;
}

export interface ModModelTotals {
  model: string;
  input: number;
  output: number;
  cachedRead: number;
  cachedWrite: number;
  costUsd: number | null;
}

const optionalLabel = (text: string | null) => (text === null ? null : storedLabel(text));

export async function recordModTurn(db: Db, runId: string, turn: ModTurnEvent): Promise<void> {
  const values = [runId, storedLabel(turn.turnId), optionalLabel(turn.agentId)];
  if (turn.phase === 'start') {
    await db.query(
      `INSERT INTO native_terminal_mod_turns (run_id, turn_id, agent_id, started_at)
       SELECT id, $2, $3, $4 FROM runs WHERE id = $1
       ON CONFLICT (run_id, turn_id) DO NOTHING`,
      [...values, turn.at],
    );
    return;
  }
  await db.query(
    `INSERT INTO native_terminal_mod_turns (run_id, turn_id, agent_id, duration_ms, aborted)
     SELECT id, $2, $3, $4, $5 FROM runs WHERE id = $1
     ON CONFLICT (run_id, turn_id) DO UPDATE SET
       duration_ms = EXCLUDED.duration_ms, aborted = EXCLUDED.aborted`,
    [...values, turn.durationMs ?? null, turn.aborted ?? false],
  );
}

export async function recordModRequest(db: Db, runId: string, request: ModRequest): Promise<void> {
  await db.query(
    `INSERT INTO native_terminal_requests (run_id, turn_id, step_index, agent_id, model,
       input_tokens, output_tokens, cached_read_tokens, cached_write_tokens, cost_usd)
     SELECT id, $2, $3, $4, $5, $6, $7, $8, $9, $10 FROM runs WHERE id = $1
     ON CONFLICT (run_id, turn_id, step_index) DO NOTHING`,
    [
      runId,
      storedLabel(request.turnId),
      request.index,
      optionalLabel(request.agentId),
      storedLabel(request.model),
      request.input,
      request.output,
      request.cachedRead,
      request.cachedWrite,
      request.costUsd,
    ],
  );
}

export async function modOwnsRun(db: Queryable, runId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM native_terminal_mod_turns
     WHERE run_id = $1 AND agent_id IS NULL AND started_at IS NOT NULL`,
    [runId],
  );
  return (rowCount ?? 0) > 0;
}

export async function modRequestTotals(db: Queryable, runId: string): Promise<ModModelTotals[]> {
  const { rows } = await db.query<{
    model: string;
    input: string;
    output: string;
    cached_read: string;
    cached_write: string;
    cost_usd: string | null;
  }>(
    `SELECT model, sum(input_tokens) AS input, sum(output_tokens) AS output,
       sum(cached_read_tokens) AS cached_read, sum(cached_write_tokens) AS cached_write,
       CASE WHEN bool_and(cost_usd IS NOT NULL) THEN sum(cost_usd)::text END AS cost_usd
     FROM native_terminal_requests WHERE run_id = $1 GROUP BY model
     ORDER BY bool_or(agent_id IS NULL), max(recorded_at)`,
    [runId],
  );
  return rows.map((row) => ({
    model: row.model,
    input: Number(row.input),
    output: Number(row.output),
    cachedRead: Number(row.cached_read),
    cachedWrite: Number(row.cached_write),
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
  }));
}

export async function recordModUsage(
  db: Db,
  runId: string,
  { model, tokens, costUsd }: NativeTurnTotals,
  reported: boolean,
): Promise<void> {
  await db.query(
    `UPDATE runs SET input_tokens = $2, output_tokens = $3, total_tokens = $4,
       cached_read_tokens = $5, cached_write_tokens = $6, thought_tokens = NULL,
       used_model = COALESCE($7, used_model), cost_usd = $8::numeric,
       cost_source = CASE WHEN $8::numeric IS NULL THEN NULL WHEN $9 THEN 'reported' ELSE 'estimated' END
     WHERE id = $1`,
    [
      runId,
      tokens.input,
      tokens.output,
      tokens.total,
      tokens.cachedRead,
      tokens.cachedWrite,
      model === null ? null : storedLabel(model),
      costUsd,
      reported,
    ],
  );
}

export async function moveModUsage(db: Queryable, runId: string, ownerRunId: string) {
  await db.query(
    `UPDATE native_terminal_mod_turns t SET run_id = $2 WHERE t.run_id = $1 AND NOT EXISTS (
       SELECT 1 FROM native_terminal_mod_turns o WHERE o.run_id = $2 AND o.turn_id = t.turn_id)`,
    [runId, ownerRunId],
  );
  await db.query(
    `UPDATE native_terminal_requests r SET run_id = $2 WHERE r.run_id = $1 AND NOT EXISTS (
       SELECT 1 FROM native_terminal_requests o
       WHERE o.run_id = $2 AND o.turn_id = r.turn_id AND o.step_index = r.step_index)`,
    [runId, ownerRunId],
  );
}
