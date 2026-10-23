import { QUEUE_LIMIT, type QueuedMessage } from '@spark-outpost/contracts';
import { rememberRemoteMessage } from '../remote/run-mark.ts';
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
  outpost_post_id: string | null;
  spark_rule_card_id?: string | null;
  origin?: QueuedMessage['origin'] | null;
  attachment_ids?: string[];
}

export const PAUSED_OUTPOST_ITEM = `EXISTS (
  SELECT 1 FROM outpost_posts post JOIN outposts o ON o.id = post.outpost_id
  WHERE post.id = q.outpost_post_id AND o.paused_at IS NOT NULL
)`;

export function postedAfterStop(post: string, lastRun: string): string {
  return `(${post}.from_user AND ${lastRun}.status = 'cancelled'
    AND ${post}.created_at > ${lastRun}.cancel_requested_at)`;
}

const POSTED_AFTER_STOP_ITEM = `EXISTS (
  SELECT 1 FROM outpost_posts post
  JOIN LATERAL (
    SELECT r.status, r.cancel_requested_at FROM runs r
    WHERE r.conversation_id = q.conversation_id AND r.parent_run_id IS NULL
    ORDER BY r.created_at DESC LIMIT 1
  ) last ON true
  WHERE post.id = q.outpost_post_id AND ${postedAfterStop('post', 'last')}
)`;

function toQueued(row: QueueRow): QueuedMessage {
  return {
    id: row.id,
    content: row.content,
    position: row.position,
    continueRunId: row.continue_run_id,
    createdAt: row.created_at.toISOString(),
    ...(row.outpost_post_id ? { outpostPostId: row.outpost_post_id } : {}),
    ...(row.spark_rule_card_id ? { sparkRuleCardId: row.spark_rule_card_id } : {}),
    ...(row.origin ? { origin: row.origin } : {}),
    ...(row.attachment_ids?.length ? { attachmentIds: row.attachment_ids } : {}),
  };
}

export interface NewQueued {
  id: string;
  content: string;
  continueRunId?: string | null;
  sparkRuleCardId?: string | null;
  origin?: QueuedMessage['origin'];
  attachmentIds?: readonly string[];
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
    `INSERT INTO chat_queue (id, conversation_id, position, content, continue_run_id,
       spark_rule_card_id, origin, attachment_ids)
     SELECT $1, $2, COALESCE(MAX(position), 0) + 1, $3, $4, $5, $6, $7
     FROM chat_queue WHERE conversation_id = $2
     ON CONFLICT (id) DO NOTHING`,
    [
      item.id,
      conversationId,
      item.content,
      item.continueRunId ?? null,
      item.sparkRuleCardId ?? null,
      item.origin ?? null,
      [...(item.attachmentIds ?? [])],
    ],
  );
  await rememberRemoteMessage(db, item.id);
}

export async function editQueued(
  db: Queryable,
  conversationId: string,
  id: string,
  content: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE chat_queue SET content = $3, updated_at = now()
     WHERE conversation_id = $1 AND id = $2 AND outpost_post_id IS NULL`,
    [conversationId, id, content],
  );
  if (rowCount === 1) return;
  const outpostItem = await db.query(
    'SELECT 1 FROM chat_queue WHERE conversation_id = $1 AND id = $2',
    [conversationId, id],
  );
  if (outpostItem.rowCount === 1) {
    throw new QueueError(409, 'A request from an outpost can’t be edited. Remove it instead.');
  }
  throw new QueueError(404, 'That message has already been sent.');
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
       SELECT q.id FROM chat_queue q
       WHERE q.conversation_id = $1
         AND (q.id = $2 OR ($2::uuid IS NULL AND NOT ${PAUSED_OUTPOST_ITEM}))
       ORDER BY q.position, q.created_at, q.id LIMIT 1
       FOR UPDATE OF q
     ) RETURNING *`,
    [conversationId, id],
  );
  return rows[0] ? toQueued(rows[0]) : null;
}

export async function takeTypedRequest(
  db: Queryable,
  conversationId: string,
  postId: string,
  flowing: boolean,
): Promise<QueuedMessage | null> {
  const { rows } = await db.query<QueueRow>(
    `DELETE FROM chat_queue WHERE id = (
       SELECT q.id FROM chat_queue q JOIN outpost_posts typed ON typed.id = q.outpost_post_id
       WHERE q.conversation_id = $1 AND q.outpost_post_id = $2 AND typed.from_user
         AND NOT ${PAUSED_OUTPOST_ITEM} ${flowing ? '' : `AND ${POSTED_AFTER_STOP_ITEM}`}
       FOR UPDATE OF q
     ) RETURNING *`,
    [conversationId, postId],
  );
  return rows[0] ? toQueued(rows[0]) : null;
}

export async function takePostedAfterStop(
  db: Queryable,
  conversationId: string,
): Promise<QueuedMessage | null> {
  const { rows } = await db.query<QueueRow>(
    `DELETE FROM chat_queue WHERE id = (
       SELECT q.id FROM chat_queue q
       WHERE q.conversation_id = $1 AND NOT ${PAUSED_OUTPOST_ITEM} AND ${POSTED_AFTER_STOP_ITEM}
       ORDER BY q.position, q.created_at, q.id LIMIT 1
       FOR UPDATE OF q
     ) RETURNING *`,
    [conversationId],
  );
  return rows[0] ? toQueued(rows[0]) : null;
}

export async function queuedOutpostPost(
  db: Queryable,
  conversationId: string,
  id: string,
): Promise<string | null> {
  const { rows } = await db.query<{ outpost_post_id: string | null }>(
    'SELECT outpost_post_id FROM chat_queue WHERE conversation_id = $1 AND id = $2',
    [conversationId, id],
  );
  return rows[0]?.outpost_post_id ?? null;
}
