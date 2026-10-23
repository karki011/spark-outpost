import type { Queryable } from './db.ts';

export async function runOrigin(db: Queryable, runId: string): Promise<string | null> {
  const { rows } = await db.query<{ source: string | null }>(
    `WITH top AS (
       SELECT top_run.* FROM runs r
       JOIN runs top_run ON top_run.id = COALESCE(r.parent_run_id, r.id)
       WHERE r.id = $1
     )
     SELECT CASE WHEN top.source = 'agent_cycle' THEN (
         SELECT prior.source FROM runs prior
         WHERE prior.conversation_id = top.conversation_id
           AND prior.parent_run_id IS NULL
           AND prior.source <> 'agent_cycle'
           AND (prior.created_at, prior.id) < (top.created_at, top.id)
         ORDER BY prior.created_at DESC, prior.id DESC
         LIMIT 1
       ) ELSE top.source END AS source
     FROM top`,
    [runId],
  );
  return rows[0]?.source ?? null;
}
