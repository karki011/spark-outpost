import {
  recapBodySchema,
  recapTotalsSchema,
  type RecapBody,
  type RecapRefine,
  type RecapStatus,
  type RecapTotals,
  type RecapVoice,
  type WeekRecap,
} from '@spark-outpost/contracts';
import type { RecapFact } from '../recap/facts.ts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { abandonedRun, insertHiddenRun } from './hidden-runs.ts';
import { newId } from './ids.ts';
import { requestCancel } from './runs.ts';

const STALE_MESSAGE = 'The recap did not finish. Try again.';
const REFINE_STALE_MESSAGE = 'The rewrite did not finish. Try again.';
const EMPTY_TOTALS: RecapTotals = { chats: 0, merged: 0, open: 0, tickets: 0 };

export interface RecapSetting {
  enabled: boolean;
  day: number;
  time: string;
}

export async function recapSetting(db: Queryable, workspaceId: string): Promise<RecapSetting> {
  const { rows } = await db.query<RecapSetting>(
    `SELECT week_recap AS enabled, week_recap_day AS day,
       to_char(week_recap_time, 'HH24:MI') AS time
     FROM profiles WHERE workspace_id = $1`,
    [workspaceId],
  );
  return rows[0] ?? { enabled: true, day: 5, time: '15:00' };
}

export async function claimWeekRecap(
  db: Queryable,
  workspaceId: string,
  weekStartDay: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE profiles SET week_recap_tried_on = $2::date
     WHERE workspace_id = $1
       AND (week_recap_tried_on IS NULL OR week_recap_tried_on < $2::date)`,
    [workspaceId, weekStartDay],
  );
  return rowCount === 1;
}

export async function releaseWeekRecap(
  db: Queryable,
  workspaceId: string,
  weekStartDay: string,
): Promise<void> {
  await db.query(
    `UPDATE profiles SET week_recap_tried_on = NULL
     WHERE workspace_id = $1 AND week_recap_tried_on = $2::date`,
    [workspaceId, weekStartDay],
  );
}

export interface StoredFacts {
  week: string;
  facts: RecapFact[];
  totals: RecapTotals;
}

export interface RecapModel {
  provider: string;
  model: string | null;
  modelLabel: string | null;
  effort: string | null;
}

export interface NewRecap extends RecapModel {
  weekStart: string;
  since: Date;
  until: Date;
  prompt: string;
  facts: StoredFacts;
}

interface Progress {
  status: RecapStatus;
  error: string | null;
  created_at: Date;
  run_status: string | null;
  run_finished_at: Date | null;
}

function effective(row: Progress, now: Date, stale: string) {
  if (row.status !== 'running') return { status: row.status, error: row.error };
  const progress = {
    runStatus: row.run_status,
    runFinishedAt: row.run_finished_at,
    createdAt: row.created_at,
  };
  return abandonedRun(progress, now)
    ? { status: 'failed' as const, error: stale }
    : { status: 'running' as const, error: null };
}

async function cancelStaleRun(client: Queryable, runId: string) {
  await requestCancel(client, runId);
  await client.query(
    `UPDATE jobs SET status = 'done', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE run_id = $1 AND status = 'queued'`,
    [runId],
  );
  await client.query(
    `UPDATE runs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'queued'`,
    [runId],
  );
}

async function closeAbandoned(client: Queryable, table: string, where: string, value: string) {
  const { rows } = await client.query<Progress & { id: string; run_id: string | null }>(
    `SELECT x.id, x.run_id, x.status, x.error, x.created_at, r.status AS run_status,
       r.finished_at AS run_finished_at
     FROM ${table} x LEFT JOIN runs r ON r.id = x.run_id
     WHERE x.${where} = $1 AND x.status = 'running'`,
    [value],
  );
  const now = new Date();
  const abandoned = rows.filter((row) => effective(row, now, '').status === 'failed');
  for (const row of abandoned) {
    await client.query(
      `UPDATE ${table} SET status = 'failed', error = $2, finished_at = now()
       WHERE id = $1 AND status = 'running'`,
      [row.id, table === 'week_recaps' ? STALE_MESSAGE : REFINE_STALE_MESSAGE],
    );
    if (row.run_id) await cancelStaleRun(client, row.run_id);
  }
  return rows.length - abandoned.length;
}

export async function startRecap(
  db: Db,
  workspaceId: string,
  recap: NewRecap,
): Promise<string | null> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`recap:${workspaceId}`]);
    if ((await closeAbandoned(client, 'week_recaps', 'workspace_id', workspaceId)) > 0) {
      return null;
    }
    const { conversationId, runId } = await insertHiddenRun(client, workspaceId, {
      title: 'Week recap',
      archived: true,
      prompt: recap.prompt,
      provider: recap.provider,
      model: recap.model,
      effort: recap.effort,
    });
    const id = newId();
    await client.query(
      `INSERT INTO week_recaps (id, workspace_id, conversation_id, run_id, status, week_start,
         since, until, facts, provider, model, model_label)
       VALUES ($1, $2, $3, $4, 'running', $5::date, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        workspaceId,
        conversationId,
        runId,
        recap.weekStart,
        recap.since,
        recap.until,
        JSON.stringify(recap.facts),
        recap.provider,
        recap.model,
        recap.modelLabel,
      ],
    );
    await client.query(`SELECT pg_notify('jobs', $1)`, [runId]);
    return id;
  });
}

interface RecapRow extends Progress {
  id: string;
  week_start: string;
  since: Date;
  until: Date;
  facts: Partial<StoredFacts> | null;
  body: unknown;
  provider: string;
  model: string | null;
  model_label: string | null;
  effort: string | null;
  finished_at: Date | null;
  cost_usd: number | null;
  cost_source: 'reported' | 'estimated' | null;
}

function toRecap(row: RecapRow, now: Date): WeekRecap {
  const { status, error } = effective(row, now, STALE_MESSAGE);
  const body = recapBodySchema.safeParse(row.body);
  const totals = recapTotalsSchema.safeParse(row.facts?.totals);
  return {
    id: row.id,
    status,
    weekStart: row.week_start,
    since: row.since.toISOString(),
    until: row.until.toISOString(),
    body: body.success ? body.data : null,
    totals: totals.success ? totals.data : EMPTY_TOTALS,
    error,
    provider: row.provider,
    modelLabel: row.model_label,
    costUsd: row.cost_usd,
    costSource: row.cost_usd === null ? null : (row.cost_source ?? 'reported'),
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

const RECAP_SELECT = `SELECT w.id, w.status, w.error, w.created_at, to_char(w.week_start, 'YYYY-MM-DD')
    AS week_start, w.since, w.until, w.facts, w.body, w.provider, w.model, w.model_label,
    r.effort, w.finished_at, r.status AS run_status, r.finished_at AS run_finished_at,
    r.cost_usd::float8 AS cost_usd, r.cost_source
  FROM week_recaps w LEFT JOIN runs r ON r.id = w.run_id`;

export async function latestRecap(
  db: Queryable,
  workspaceId: string,
  weekStartDay: string,
  now = new Date(),
): Promise<WeekRecap | null> {
  const { rows } = await db.query<RecapRow>(
    `${RECAP_SELECT} WHERE w.workspace_id = $1 AND w.week_start = $2::date
     ORDER BY w.created_at DESC LIMIT 1`,
    [workspaceId, weekStartDay],
  );
  return rows[0] ? toRecap(rows[0], now) : null;
}

export interface RecapForRefine {
  recap: WeekRecap;
  facts: StoredFacts;
  model: RecapModel;
}

export async function recapForRefine(
  db: Queryable,
  workspaceId: string,
  recapId: string,
): Promise<RecapForRefine | null> {
  const { rows } = await db.query<RecapRow>(
    `${RECAP_SELECT} WHERE w.workspace_id = $1 AND w.id = $2`,
    [workspaceId, recapId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    recap: toRecap(row, new Date()),
    facts: { week: row.facts?.week ?? '', facts: row.facts?.facts ?? [], totals: EMPTY_TOTALS },
    model: {
      provider: row.provider,
      model: row.model,
      modelLabel: row.model_label,
      effort: row.effort,
    },
  };
}

export async function finishRecap(
  db: Queryable,
  runId: string,
  outcome: { body: RecapBody } | { error: string },
): Promise<void> {
  const ready = 'body' in outcome;
  await db.query(
    `UPDATE week_recaps SET status = $2, body = $3, error = $4, finished_at = now()
     WHERE run_id = $1 AND status = 'running'`,
    [
      runId,
      ready ? 'ready' : 'failed',
      ready ? JSON.stringify(outcome.body) : null,
      ready ? null : outcome.error,
    ],
  );
}

export async function recapFactsByRun(db: Queryable, runId: string): Promise<RecapFact[]> {
  const { rows } = await db.query<{ facts: Partial<StoredFacts> | null }>(
    'SELECT facts FROM week_recaps WHERE run_id = $1',
    [runId],
  );
  return rows[0]?.facts?.facts ?? [];
}

export type RecapRunKind = 'recap' | 'refine';

export async function recapRunKind(db: Queryable, runId: string): Promise<RecapRunKind | null> {
  const { rows } = await db.query<{ kind: RecapRunKind }>(
    `SELECT 'recap' AS kind FROM week_recaps WHERE run_id = $1
     UNION ALL SELECT 'refine' FROM week_recap_refines WHERE run_id = $1 LIMIT 1`,
    [runId],
  );
  return rows[0]?.kind ?? null;
}

export interface NewRefine {
  voice: RecapVoice;
  instruction: string;
  textIn: string;
  prompt: string;
  model: RecapModel;
}

export async function startRefine(
  db: Db,
  workspaceId: string,
  recapId: string,
  refine: NewRefine,
): Promise<string | null> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`recap-refine:${recapId}`]);
    if ((await closeAbandoned(client, 'week_recap_refines', 'recap_id', recapId)) > 0) {
      return null;
    }
    const { runId } = await insertHiddenRun(client, workspaceId, {
      title: 'Week recap rewrite',
      archived: true,
      prompt: refine.prompt,
      provider: refine.model.provider,
      model: refine.model.model,
      effort: refine.model.effort,
    });
    const id = newId();
    await client.query(
      `INSERT INTO week_recap_refines (id, recap_id, run_id, voice, instruction, text_in, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'running')`,
      [id, recapId, runId, refine.voice, refine.instruction, refine.textIn],
    );
    await client.query(`SELECT pg_notify('jobs', $1)`, [runId]);
    return id;
  });
}

export async function refineContextByRun(
  db: Queryable,
  runId: string,
): Promise<{ facts: RecapFact[]; textIn: string } | null> {
  const { rows } = await db.query<{ facts: Partial<StoredFacts> | null; text_in: string }>(
    `SELECT w.facts, f.text_in FROM week_recap_refines f JOIN week_recaps w ON w.id = f.recap_id
     WHERE f.run_id = $1`,
    [runId],
  );
  const row = rows[0];
  return row ? { facts: row.facts?.facts ?? [], textIn: row.text_in } : null;
}

export async function finishRefine(
  db: Queryable,
  runId: string,
  outcome: { text: string } | { error: string },
): Promise<void> {
  const ready = 'text' in outcome;
  await db.query(
    `UPDATE week_recap_refines SET status = $2, text_out = $3, error = $4, finished_at = now()
     WHERE run_id = $1 AND status = 'running'`,
    [runId, ready ? 'ready' : 'failed', ready ? outcome.text : null, ready ? null : outcome.error],
  );
}

interface RefineRow extends Progress {
  id: string;
  voice: RecapVoice;
  instruction: string;
  text_in: string;
  text_out: string | null;
  cost_usd: number | null;
}

export async function recapRefines(
  db: Queryable,
  recapId: string,
  now = new Date(),
): Promise<RecapRefine[]> {
  const { rows } = await db.query<RefineRow>(
    `SELECT f.id, f.voice, f.instruction, f.text_in, f.text_out, f.status, f.error, f.created_at,
       r.status AS run_status, r.finished_at AS run_finished_at, r.cost_usd::float8 AS cost_usd
     FROM week_recap_refines f LEFT JOIN runs r ON r.id = f.run_id
     WHERE f.recap_id = $1 ORDER BY f.created_at`,
    [recapId],
  );
  return rows.map((row) => {
    const { status, error } = effective(row, now, REFINE_STALE_MESSAGE);
    return {
      id: row.id,
      voice: row.voice,
      instruction: row.instruction,
      textIn: row.text_in,
      textOut: row.text_out,
      status,
      error,
      costUsd: row.cost_usd,
      createdAt: row.created_at.toISOString(),
    };
  });
}
