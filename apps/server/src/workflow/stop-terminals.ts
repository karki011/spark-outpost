import { stopRunAgentTerminals } from '../persistence/agent-terminal-changes.ts';
import type { Db } from '../persistence/db.ts';
import { recordTerminalStop } from './terminal-audit.ts';

async function runTree(db: Db, runId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM runs WHERE id = $1
       UNION ALL
       SELECT child.id FROM runs child JOIN tree ON child.parent_run_id = tree.id
     )
     SELECT id FROM tree`,
    [runId],
  );
  return rows.map((row) => row.id);
}

export async function stopTurnTerminals(db: Db, runId: string): Promise<void> {
  for (const id of await runTree(db, runId)) {
    for (const row of await stopRunAgentTerminals(db, id)) {
      await recordTerminalStop(db, row, 'turn_stopped').catch((error: unknown) =>
        console.error('Could not record a terminal stop in the audit', error),
      );
    }
  }
}
