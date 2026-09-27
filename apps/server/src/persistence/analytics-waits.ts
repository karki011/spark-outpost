import type { AnalyticsWindow } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { WINDOW_FILTER, windowParams } from './analytics-facts.ts';

export interface ApprovalWaitRow {
  kind: string;
  waitMs: number;
}

export async function approvalWaits(
  db: Queryable,
  workspaceId: string,
  window: AnalyticsWindow,
): Promise<ApprovalWaitRow[]> {
  const { rows } = await db.query<{ kind: string; wait_ms: number }>(
    `SELECT a.kind,
       GREATEST(0, EXTRACT(EPOCH FROM (a.decided_at - a.created_at)) * 1000)::float8 AS wait_ms
     FROM approvals a JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND ${WINDOW_FILTER}
       AND a.decided_by = 'user' AND a.decided_at IS NOT NULL`,
    windowParams(workspaceId, window),
  );
  return rows.map((row) => ({ kind: row.kind, waitMs: row.wait_ms }));
}
