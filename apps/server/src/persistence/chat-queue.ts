import { QUEUE_LIMIT, type QueuedMessage } from '@spark-outpost/contracts';
import { validateQueuedAttachments } from './queued-attachments.ts';
import { rememberRemoteMessage } from '../remote/run-mark.ts';
import { withTransaction, type Db, type DbClient, type Queryable } from './db.ts';

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
  spark_rule_card_id?: string | null;
  origin?: QueuedMessage['origin'] | null;
  from_chat?: string | null;
  attachment_ids?: string[];
  annotations?: QueuedMessage['annotations'];
}

function toQueued(row: QueueRow): QueuedMessage {
  return {
    id: row.id,
    content: row.content,
    position: row.position,
    continueRunId: row.continue_run_id,
    createdAt: row.created_at.toISOString(),
    ...(row.spark_rule_card_id ? { sparkRuleCardId: row.spark_rule_card_id } : {}),
    ...(row.origin ? { origin: row.origin } : {}),
    ...(row.from_chat ? { fromChat: row.from_chat } : {}),
    ...(row.annotations?.length ? { annotations: row.annotations } : {}),
    ...(row.attachment_ids?.length ? { attachmentIds: row.attachment_ids } : {}),
  };
}

export interface NewQueued {
  id: string;
  content: string;
  sparkRuleCardId?: string | null;
  origin?: QueuedMessage['origin'];
  attachmentIds?: readonly string[] | undefined;
  annotations?: QueuedMessage['annotations'];
}

export async function listQueue(db: Queryable, conversationId: string): Promise<QueuedMessage[]> {
  const { rows } = await db.query<QueueRow>(
    `SELECT q.*, (SELECT COALESCE(sender.title, a.from_title) FROM chat_asks a
                  LEFT JOIN conversations sender ON sender.id = a.from_conversation_id
                  WHERE a.id = q.id) AS from_chat
     FROM chat_queue q WHERE q.conversation_id = $1 ORDER BY q.position, q.created_at, q.id`,
    [conversationId],
  );
  return rows.map(toQueued);
}

export async function assertMessageOwner(
  db: Queryable,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [messageId]);
  const owners = await db.query<{ conversation_id: string }>(
    `SELECT conversation_id FROM messages WHERE id = $1
     UNION ALL SELECT conversation_id FROM member_messages WHERE id = $1
     UNION ALL SELECT conversation_id FROM chat_queue WHERE id = $1`,
    [messageId],
  );
  if (owners.rows.some((row) => row.conversation_id !== conversationId))
    throw new QueueError(409, 'That message ID belongs to another chat.');
}

export async function alreadySent(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM messages WHERE id = $1', [id]);
  return rowCount === 1;
}

export type QueuePlace = 'back' | 'front';

const PLACED_POSITION: Record<QueuePlace, string> = {
  back: 'COALESCE(MAX(position), 0) + 1',
  front: 'COALESCE(MIN(position), 1) - 1',
};

export async function addToQueue(
  db: Db | DbClient,
  conversationId: string,
  item: NewQueued,
  place: QueuePlace = 'back',
): Promise<void> {
  if ('release' in db) return addInTransaction(db, conversationId, item, place);
  return withTransaction(db, (client) => addInTransaction(client, conversationId, item, place));
}

async function addInTransaction(
  db: Queryable,
  conversationId: string,
  item: NewQueued,
  place: QueuePlace,
): Promise<void> {
  const session = await db.query<{ session_type: string }>(
    'SELECT session_type FROM conversations WHERE id = $1 FOR UPDATE',
    [conversationId],
  );
  if (session.rows[0]?.session_type === 'terminal')
    throw new QueueError(409, 'Send messages in this session’s terminal.');
  await assertMessageOwner(db, conversationId, item.id);
  if (await alreadySent(db, item.id)) return;
  const accepted = await db.query('SELECT 1 FROM member_messages WHERE id = $1', [item.id]);
  if (accepted.rowCount)
    throw new QueueError(409, 'This message was already accepted. Send a new message instead.');
  await validateQueuedAttachments(
    db,
    conversationId,
    item.id,
    item.attachmentIds,
    item.annotations,
  );
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM chat_queue WHERE conversation_id = $1',
    [conversationId],
  );
  if ((rows[0]?.count ?? 0) >= QUEUE_LIMIT) {
    throw new QueueError(409, `The queue holds ${QUEUE_LIMIT} messages. Send or remove one first.`);
  }
  await db.query(
    `INSERT INTO chat_queue (id, conversation_id, position, content,
       spark_rule_card_id, origin, attachment_ids, annotations)
     SELECT $1, $2, ${PLACED_POSITION[place]}, $3, $4, $5, $6, $7
     FROM chat_queue WHERE conversation_id = $2
     ON CONFLICT (id) DO NOTHING`,
    [
      item.id,
      conversationId,
      item.content,
      item.sparkRuleCardId ?? null,
      item.origin ?? null,
      [...(item.attachmentIds ?? [])],
      JSON.stringify(item.annotations ?? []),
    ],
  );
  await assertMessageOwner(db, conversationId, item.id);
  await rememberRemoteMessage(db, item.id);
}

interface KeptRow {
  spark_rule_card_id: string | null;
  origin: string | null;
}

function uneditableReason(row: KeptRow): string {
  if (row.origin === 'chat') {
    return 'A message from another chat can’t be edited. Remove it instead.';
  }
  if (row.spark_rule_card_id) {
    return 'A retry from a Spark rules card can’t be edited. Remove it instead.';
  }
  return 'Keep a message or an attachment.';
}

export async function editQueued(
  db: Queryable,
  conversationId: string,
  id: string,
  content: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE chat_queue SET content = $3, updated_at = now()
     WHERE conversation_id = $1 AND id = $2
       AND spark_rule_card_id IS NULL
       AND origin IS DISTINCT FROM 'chat'
       AND (length($3) > 0 OR cardinality(attachment_ids) > 0)`,
    [conversationId, id, content],
  );
  if (rowCount === 1) return;
  const kept = await db.query<KeptRow>(
    `SELECT spark_rule_card_id, origin FROM chat_queue
     WHERE conversation_id = $1 AND id = $2`,
    [conversationId, id],
  );
  const row = kept.rows[0];
  if (row) throw new QueueError(409, uneditableReason(row));
  throw new QueueError(404, 'That message has already been sent.');
}

function sameIds(current: readonly string[], wanted: readonly string[]): boolean {
  const unique = new Set(wanted);
  return (
    unique.size === wanted.length &&
    current.length === wanted.length &&
    current.every((id) => unique.has(id))
  );
}

export async function reorderQueue(
  db: Db,
  conversationId: string,
  ids: readonly string[],
): Promise<void> {
  await withTransaction(db, async (client) => {
    await client.query('SELECT 1 FROM conversations WHERE id = $1 FOR UPDATE', [conversationId]);
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM chat_queue WHERE conversation_id = $1',
      [conversationId],
    );
    const current = rows.map((row) => row.id);
    if (!sameIds(current, ids)) {
      throw new QueueError(409, 'The queue changed while you moved a message. Try again.');
    }
    await client.query(
      `UPDATE chat_queue q SET position = ordered.position, updated_at = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, position)
       WHERE q.conversation_id = $1 AND q.id = ordered.id`,
      [conversationId, ids],
    );
  });
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
         AND (q.id = $2 OR $2::uuid IS NULL)
       ORDER BY q.position, q.created_at, q.id LIMIT 1
       FOR UPDATE OF q
     ) RETURNING *`,
    [conversationId, id],
  );
  return rows[0] ? toQueued(rows[0]) : null;
}
