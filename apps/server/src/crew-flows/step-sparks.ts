import type { Queryable } from '../persistence/db.ts';
import type { MentionableSpark } from '../persistence/spark-mentions.ts';

export interface StepSpark extends MentionableSpark {
  agentMode: string | null;
}

export async function workspaceSparkIds(db: Queryable, workspaceId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM teammates WHERE workspace_id = $1',
    [workspaceId],
  );
  return new Set(rows.map((row) => row.id));
}

export async function stepSparks(
  db: Queryable,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, StepSpark>> {
  const { rows } = await db.query<StepSpark>(
    `SELECT t.id, t.name, t.role, t.provider, t.model, t.effort, t.agent_mode AS "agentMode",
       EXISTS (
         SELECT 1 FROM provider_connections pc
         WHERE pc.workspace_id = t.workspace_id AND pc.provider = t.provider
           AND pc.disconnected_at IS NULL
       ) AS connected
     FROM teammates t WHERE t.workspace_id = $1 AND t.id = ANY($2::uuid[])`,
    [workspaceId, ids],
  );
  return new Map(rows.map((row) => [row.id, row]));
}
