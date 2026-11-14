import { childRun } from '../mac-control/offered.ts';
import type { Queryable } from '../persistence/db.ts';
import { runFromDevice } from '../remote/run-mark.ts';
import { rulesSession } from '../spark-mcp/actions/rules-edit-session.ts';

export async function outsideWriteGranted(db: Queryable, runId: string): Promise<boolean> {
  if ((await childRun(db, runId)) || (await runFromDevice(db, runId))) return false;
  const current = await rulesSession(db, runId);
  if (!current?.fromUser || !current.sessionRow) return false;
  const { rowCount } = await db.query(
    `SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = (SELECT conversation_id FROM runs WHERE id = $1)
       AND a.scope = 'chat' AND a.status = 'allowed' AND a.decided_by = 'user'
       AND a.payload->>'outsideWrite' = $4
       AND r.provider = $2 AND r.agent_mode IS NOT DISTINCT FROM $3
       AND NOT EXISTS (
         SELECT 1 FROM runs later
         WHERE later.conversation_id = r.conversation_id AND later.parent_run_id IS NULL
           AND later.created_at > a.decided_at
           AND (later.provider IS DISTINCT FROM $2 OR later.agent_mode IS DISTINCT FROM $3))
     LIMIT 1`,
    [runId, current.provider, current.agentMode, current.sessionRow],
  );
  return rowCount === 1;
}
