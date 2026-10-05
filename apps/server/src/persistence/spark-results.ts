import {
  SPARK_ACTION_KIND,
  sparkRetryAllowed,
  type Approval,
  type SparkResult,
} from '@spark-outpost/contracts';
import {
  ApprovalConflictError,
  ApprovalNotFoundError,
  notifyApprovalChanged,
  toApproval,
  type ApprovalRow,
} from './approvals.ts';
import type { Queryable } from './db.ts';

export interface ClaimedSparkAction {
  approval: Approval;
  workspaceId: string;
  conversationId: string;
}

export const WAITING_RESULT: SparkResult = { state: 'waiting', message: null, url: null };

export async function claimSparkAction(db: Queryable): Promise<ClaimedSparkAction | null> {
  const { rows } = await db.query<ApprovalRow & { workspace_id: string; conversation_id: string }>(
    `WITH next AS (
       SELECT a.id FROM approvals a
       WHERE a.kind = $1 AND a.status = 'allowed'
         AND a.payload->'sparkResult'->>'state' = 'waiting'
       ORDER BY a.decided_at, a.created_at
       LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     UPDATE approvals a
     SET payload = jsonb_set(a.payload, '{sparkResult,state}', '"running"')
     FROM next, runs r JOIN conversations c ON c.id = r.conversation_id
     WHERE a.id = next.id AND r.id = a.run_id
     RETURNING a.*, c.workspace_id, c.id AS conversation_id`,
    [SPARK_ACTION_KIND],
  );
  const row = rows[0];
  if (!row) return null;
  await notifyApprovalChanged(db, row.id);
  return {
    approval: toApproval(row),
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
  };
}

export async function finishSparkAction(
  db: Queryable,
  id: string,
  result: SparkResult,
): Promise<void> {
  await db.query(
    `UPDATE approvals SET payload = jsonb_set(payload, '{sparkResult}', $2::jsonb) WHERE id = $1`,
    [id, JSON.stringify(result)],
  );
  await notifyApprovalChanged(db, id);
}

export async function lastFailedAttempt(
  db: Queryable,
  conversationId: string | null,
  action: string,
): Promise<string | null> {
  if (!conversationId) return null;
  const { rows } = await db.query<{ state: string | null; message: string | null }>(
    `SELECT a.payload->'sparkResult'->>'state' AS state,
       a.payload->'sparkResult'->>'message' AS message
     FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2 AND a.status = 'allowed'
       AND a.payload->'sparkAction'->>'action' = $3
     ORDER BY a.created_at DESC, a.id DESC LIMIT 1`,
    [conversationId, SPARK_ACTION_KIND, action],
  );
  return rows[0]?.state === 'failed' ? (rows[0].message ?? 'It failed.') : null;
}

export async function abandonRunningSparkActions(db: Queryable, message: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE approvals
     SET payload = jsonb_set(payload, '{sparkResult}', jsonb_build_object(
       'state', 'unknown', 'message', $2::text, 'url', NULL))
     WHERE kind = $1 AND payload->'sparkResult'->>'state' = 'running'
     RETURNING id`,
    [SPARK_ACTION_KIND, message],
  );
  for (const row of rows) await notifyApprovalChanged(db, row.id);
  return rows.length;
}

export async function retrySparkAction(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<Approval> {
  const found = await db.query<ApprovalRow>(
    `SELECT a.* FROM approvals a JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE a.id = $1 AND c.workspace_id = $2 AND a.kind = $3`,
    [id, workspaceId, SPARK_ACTION_KIND],
  );
  if (!found.rows[0]) throw new ApprovalNotFoundError();
  const current = toApproval(found.rows[0]);
  const { sparkAction, sparkResult } = current.payload;
  if (
    current.status !== 'allowed' ||
    !sparkAction ||
    !sparkRetryAllowed(sparkAction, sparkResult)
  ) {
    throw new ApprovalConflictError(
      sparkResult?.state === 'unknown'
        ? 'Repeating this could do it twice. Check what happened, then ask the agent again.'
        : 'Spark is already doing this, or it is done.',
    );
  }
  const { rows } = await db.query<ApprovalRow>(
    `UPDATE approvals SET payload = jsonb_set(payload, '{sparkResult}', $2::jsonb)
     WHERE id = $1 AND payload->'sparkResult'->>'state' = $3
     RETURNING *`,
    [id, JSON.stringify(WAITING_RESULT), sparkResult!.state],
  );
  if (!rows[0]) throw new ApprovalConflictError('Spark is already doing this, or it is done.');
  await notifyApprovalChanged(db, id);
  return toApproval(rows[0]);
}
