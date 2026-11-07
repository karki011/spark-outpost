import type { PluginFinding, ProviderId } from '@spark-outpost/contracts';
import { withTransaction, type Db, type Queryable } from '../../persistence/db.ts';
import { insertHiddenRun } from '../../persistence/hidden-runs.ts';
import { needsReview, type StoredReview } from './review-result.ts';

interface ReviewRow {
  plugin_key: string;
  fingerprint: string;
  findings: PluginFinding[] | null;
  error: string | null;
  created_at: Date;
  run_status: string | null;
  tokens: number | null;
  cost_usd: number | null;
}

const REVIEW_SELECT = `SELECT v.plugin_key, v.fingerprint, v.findings, v.error, v.created_at,
    r.status AS run_status,
    COALESCE(r.total_tokens, r.input_tokens + r.output_tokens)::float8 AS tokens,
    r.cost_usd::float8 AS cost_usd
  FROM user_plugin_reviews v LEFT JOIN runs r ON r.id = v.run_id`;

function storedReview(row: ReviewRow): StoredReview {
  return {
    findings: row.findings,
    error: row.error,
    runStatus: row.run_status,
    createdAt: row.created_at,
    tokens: row.tokens,
    costUsd: row.cost_usd,
  };
}

export function reviewKey(pluginKey: string, fingerprint: string): string {
  return `${pluginKey}\u0000${fingerprint}`;
}

export async function loadPluginReviews(
  db: Queryable,
  workspaceId: string,
): Promise<Map<string, StoredReview>> {
  const { rows } = await db.query<ReviewRow>(`${REVIEW_SELECT} WHERE v.workspace_id = $1`, [
    workspaceId,
  ]);
  return new Map(
    rows.map((row) => [reviewKey(row.plugin_key, row.fingerprint), storedReview(row)]),
  );
}

export interface ReviewModel {
  provider: ProviderId;
  model: string | null;
  effort: string | null;
}

export interface ReviewRequest {
  pluginKey: string;
  fingerprint: string;
  prompt: string;
}

export async function startPluginReview(
  db: Db,
  workspaceId: string,
  request: ReviewRequest,
  model: ReviewModel,
  again = false,
): Promise<boolean> {
  const { pluginKey, fingerprint, prompt } = request;
  return withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `plugin-review:${workspaceId}:${pluginKey}:${fingerprint}`,
    ]);
    const { rows } = await client.query<ReviewRow>(
      `${REVIEW_SELECT} WHERE v.workspace_id = $1 AND v.plugin_key = $2 AND v.fingerprint = $3`,
      [workspaceId, pluginKey, fingerprint],
    );
    const existing = rows[0] ? storedReview(rows[0]) : undefined;
    if (!needsReview(existing, again)) return false;
    const { runId } = await insertHiddenRun(client, workspaceId, {
      title: 'Plugin review',
      archived: true,
      prompt,
      ...model,
    });
    await client.query(
      `INSERT INTO user_plugin_reviews (workspace_id, plugin_key, fingerprint, run_id, created_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (workspace_id, plugin_key, fingerprint) DO UPDATE SET
         run_id = EXCLUDED.run_id, findings = NULL, error = NULL,
         created_at = EXCLUDED.created_at, finished_at = NULL`,
      [workspaceId, pluginKey, fingerprint, runId],
    );
    await client.query(`SELECT pg_notify('jobs', $1)`, [runId]);
    return true;
  });
}

export async function isPluginReviewRun(db: Queryable, runId: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM user_plugin_reviews WHERE run_id = $1', [
    runId,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function finishPluginReview(
  db: Queryable,
  runId: string,
  outcome: { findings: PluginFinding[] } | { error: string },
): Promise<void> {
  const done = 'findings' in outcome;
  await db.query(
    `UPDATE user_plugin_reviews SET findings = $2, error = $3, finished_at = now()
     WHERE run_id = $1 AND findings IS NULL AND error IS NULL`,
    [runId, done ? JSON.stringify(outcome.findings) : null, done ? null : outcome.error],
  );
}
