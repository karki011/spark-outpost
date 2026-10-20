import { withTransaction, type Db } from './db.ts';
import { newId } from './ids.ts';

export const AGENT_CYCLE_SOURCE = 'agent_cycle';

const ACTIVE = `('queued', 'running', 'awaiting_approval')`;

export async function startAgentCycleRun(
  db: Db,
  conversationId: string,
  provider: string,
): Promise<string | null> {
  return withTransaction(db, async (client) => {
    const chat = await client.query(
      `SELECT 1 FROM conversations
       WHERE id = $1 AND archived_at IS NULL AND session_type <> 'terminal' FOR UPDATE`,
      [conversationId],
    );
    if (!chat.rowCount) return null;
    const active = await client.query(
      `SELECT 1 FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
         AND status IN ${ACTIVE} LIMIT 1`,
      [conversationId],
    );
    if (active.rowCount) return null;
    const runId = newId();
    const { rowCount } = await client.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, model, effort, status,
         task_id, plan_version, mode, level, agent_mode, config_values, picked_mode, source)
       SELECT $1, last.conversation_id, NULL, last.provider, last.model, last.effort, 'queued',
         last.task_id, last.plan_version, last.mode, last.level, last.agent_mode,
         last.config_values, last.mode, $4
       FROM runs last
       WHERE last.conversation_id = $2 AND last.parent_run_id IS NULL AND last.provider = $3
       ORDER BY last.created_at DESC, last.id DESC LIMIT 1`,
      [runId, conversationId, provider, AGENT_CYCLE_SOURCE],
    );
    if (!rowCount) return null;
    await client.query(`INSERT INTO jobs (id, run_id, status) VALUES ($1, $2, 'queued')`, [
      newId(),
      runId,
    ]);
    await client.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [
      conversationId,
    ]);
    await client.query(`SELECT pg_notify('jobs', $1)`, [runId]);
    return runId;
  });
}

export async function closedChats(db: Db, conversationIds: readonly string[]): Promise<string[]> {
  if (conversationIds.length === 0) return [];
  const { rows } = await db.query<{ id: string }>(
    `SELECT wanted.id FROM unnest($1::uuid[]) AS wanted(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM conversations c WHERE c.id = wanted.id AND c.archived_at IS NULL
     )`,
    [conversationIds],
  );
  return rows.map((row) => row.id);
}
