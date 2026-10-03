import { SPARK_ACTION_KIND, type Approval, type SparkResult } from '@spark-outpost/contracts';
import { notifyApprovalChanged, toApproval, type ApprovalRow } from './approvals.ts';
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

export async function abandonRunningSparkActions(db: Queryable, message: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE approvals
     SET payload = jsonb_set(payload, '{sparkResult}', jsonb_build_object(
       'state', 'failed', 'message', $2::text, 'url', NULL))
     WHERE kind = $1 AND payload->'sparkResult'->>'state' = 'running'
     RETURNING id`,
    [SPARK_ACTION_KIND, message],
  );
  for (const row of rows) await notifyApprovalChanged(db, row.id);
  return rows.length;
}
