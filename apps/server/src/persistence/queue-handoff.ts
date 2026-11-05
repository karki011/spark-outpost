import { withTransaction, type Db } from './db.ts';
import { chatSparkPaused } from './spark-pause.ts';
import { runWaitingOn } from './subagents.ts';

const TYPED_BY_USER = `q.origin IS NULL AND q.outpost_post_id IS NULL
  AND q.spark_rule_card_id IS NULL AND q.continue_run_id IS NULL`;

async function hasTypedItem(db: Db, conversationId: string, skip: readonly string[]) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM chat_queue q
     WHERE q.conversation_id = $1 AND ${TYPED_BY_USER} AND NOT q.id = ANY($2::uuid[])
     LIMIT 1`,
    [conversationId, skip],
  );
  return rowCount === 1;
}

export async function handQueueToWaitingTurn(
  db: Db,
  conversationId: string,
  runId: string,
  skip: readonly string[],
): Promise<string[]> {
  if (!(await hasTypedItem(db, conversationId, skip))) return [];
  if ((await runWaitingOn(db, runId)) === 0) return [];
  return withTransaction(db, async (client) => {
    const chat = await client.query<{ archived: boolean }>(
      'SELECT archived_at IS NOT NULL AS archived FROM conversations WHERE id = $1 FOR UPDATE',
      [conversationId],
    );
    if (chat.rows[0]?.archived !== false) return [];
    if (await chatSparkPaused(client, conversationId)) return [];
    const live = await client.query(
      `SELECT 1 FROM runs WHERE id = $1 AND status IN ('queued', 'running', 'awaiting_approval')`,
      [runId],
    );
    if (live.rowCount !== 1) return [];
    const { rows } = await client.query<{ id: string }>(
      `WITH moved AS (
         DELETE FROM chat_queue q
         WHERE q.conversation_id = $1 AND ${TYPED_BY_USER} AND NOT q.id = ANY($3::uuid[])
         RETURNING q.*
       )
       INSERT INTO member_messages
         (id, conversation_id, run_id, body, urgency, attachment_ids, annotations, created_at)
       SELECT id, conversation_id, $2, content, 'now', attachment_ids, annotations,
         now() + (row_number() OVER (ORDER BY position, created_at, id)) * interval '1 millisecond'
       FROM moved
       RETURNING id`,
      [conversationId, runId, skip],
    );
    return rows.map((row) => row.id);
  });
}
