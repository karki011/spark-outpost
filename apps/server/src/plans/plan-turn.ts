import type { PlanDocument } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

export async function builtSinceApproval(
  db: Queryable,
  conversationId: string,
  plan: Pick<PlanDocument, 'approvedAt' | 'createdAt'>,
  currentRunId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ built: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM runs r
       WHERE r.conversation_id = $1 AND r.role IN ('builder', 'integrator')
         AND r.status = 'succeeded' AND r.finished_at > $2::timestamptz
         AND r.parent_run_id IS DISTINCT FROM $3
     ) AS built`,
    [conversationId, plan.approvedAt ?? plan.createdAt, currentRunId],
  );
  return rows[0]?.built === true;
}
