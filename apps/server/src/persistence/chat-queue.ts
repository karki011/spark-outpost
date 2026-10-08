import { QUEUE_LIMIT, type QueuedMessage } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export class QueueError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

interface QueueRow {
  id: string;
  content: string;
  position: number;
  continue_run_id: string | null;
  created_at: Date;
}

function toQueued(row: QueueRow): QueuedMessage {
  return {
    id: row.id,
    content: row.content,
    position: row.position,
    continueRunId: row.continue_run_id,
    createdAt: row.created_at.toISOString(),
  };
}

export interface NewQueued {
  id: string;
  content: string;
  continueRunId?: string | null;
}

export async function listQueue(db: Queryable, conversationId: string): Promise<QueuedMessage[]> {
  const { rows } = await db.query<QueueRow>(
    'SELECT * FROM chat_queue WHERE conversation_id = $1 ORDER BY position, created_at, id',
    [conversationId],
  );
  return rows.map(toQueued);
}

export async function alreadySent(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM messages WHERE id = $1', [id]);
  return rowCount === 1;
}

export async function addToQueue(
  db: Queryable,
  conversationId: string,
  item: NewQueued,
): Promise<void> {
  const session = await db.query<{ session_type: string }>(
    'SELECT session_type FROM conversations WHERE id = $1',
    [conversationId],
  );
  if (session.rows[0]?.session_type === 'terminal')
    throw new QueueError(409, 'Send messages in this session’s terminal.');
  if (await alreadySent(db, item.id)) return;
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM chat_queue WHERE conversation_id = $1',
    [conversationId],
  );
  if ((rows[0]?.count ?? 0) >= QUEUE_LIMIT) {
    throw new QueueError(409, `The queue holds ${QUEUE_LIMIT} messages. Send or remove one first.`);
  }
  await db.query(
    `INSERT INTO chat_queue (id, conversation_id, position, content, continue_run_id)
     SELECT $1, $2, COALESCE(MAX(position), 0) + 1, $3, $4
     FROM chat_queue WHERE conversation_id = $2
     ON CONFLICT (id) DO NOTHING`,
    [item.id, conversationId, item.content, item.continueRunId ?? null],
  );
}

export async function editQueued(
  db: Queryable,
  conversationId: string,
  id: string,
  content: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE chat_queue SET content = $3, updated_at = now()
     WHERE conversation_id = $1 AND id = $2`,
    [conversationId, id, content],
  );
  if (rowCount !== 1) throw new QueueError(404, 'That message has already been sent.');
}

export async function reorderQueue(
  db: Queryable,
  conversationId: string,
  ids: readonly string[],
): Promise<void> {
  await db.query(
    `UPDATE chat_queue q SET position = ordered.position, updated_at = now()
     FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, position)
     WHERE q.conversation_id = $1 AND q.id = ordered.id`,
    [conversationId, ids],
  );
}

export async function takeQueued(
  db: Queryable,
  conversationId: string,
  id: string | null,
): Promise<QueuedMessage | null> {
  const { rows } = await db.query<QueueRow>(
    `DELETE FROM chat_queue WHERE id = (
       SELECT id FROM chat_queue
       WHERE conversation_id = $1 AND ($2::uuid IS NULL OR id = $2)
       ORDER BY position, created_at, id LIMIT 1
       FOR UPDATE
     ) RETURNING *`,
    [conversationId, id],
  );
  return rows[0] ? toQueued(rows[0]) : null;
}
