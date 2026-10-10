import type {
  MemberMessage,
  MemberMessageStatus,
  MemberMessageUrgency,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface MemberMessageRow {
  id: string;
  run_id: string;
  body: string;
  urgency: MemberMessageUrgency;
  status: MemberMessageStatus;
  message_id: string | null;
  created_at: Date;
  delivered_at: Date | null;
  delivered_run_id: string | null;
}

export interface NewMemberMessage {
  id: string;
  conversationId: string;
  runId: string;
  body: string;
  urgency: MemberMessageUrgency;
  status?: MemberMessageStatus;
  messageId?: string | null;
}

function toMemberMessage(row: MemberMessageRow): MemberMessage {
  return {
    id: row.id,
    runId: row.run_id,
    body: row.body,
    urgency: row.urgency,
    status: row.status,
    messageId: row.message_id,
    createdAt: row.created_at.toISOString(),
    deliveredAt: row.delivered_at ? row.delivered_at.toISOString() : null,
    deliveredRunId: row.delivered_run_id,
  };
}

function inOrder(rows: readonly MemberMessageRow[]): MemberMessage[] {
  return [...rows]
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id))
    .map(toMemberMessage);
}

export async function insertMemberMessage(
  db: Queryable,
  message: NewMemberMessage,
): Promise<MemberMessage> {
  await db.query(
    `INSERT INTO member_messages (id, conversation_id, run_id, body, urgency, status, message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
    [
      message.id,
      message.conversationId,
      message.runId,
      message.body,
      message.urgency,
      message.status ?? 'queued',
      message.messageId ?? null,
    ],
  );
  const stored = await getMemberMessage(db, message.id);
  if (!stored) throw new Error(`Member message ${message.id} was not saved.`);
  return stored;
}

export async function getMemberMessage(db: Queryable, id: string): Promise<MemberMessage | null> {
  const { rows } = await db.query<MemberMessageRow>('SELECT * FROM member_messages WHERE id = $1', [
    id,
  ]);
  return rows[0] ? toMemberMessage(rows[0]) : null;
}

export async function listMemberMessages(
  db: Queryable,
  conversationId: string,
): Promise<MemberMessage[]> {
  const { rows } = await db.query<MemberMessageRow>(
    'SELECT * FROM member_messages WHERE conversation_id = $1 ORDER BY created_at, id',
    [conversationId],
  );
  return rows.map(toMemberMessage);
}

export async function claimMemberMessages(
  db: Queryable,
  runId: string,
  topRunId: string,
  urgentOnly: boolean,
): Promise<MemberMessage[]> {
  const { rows } = await db.query<MemberMessageRow>(
    `UPDATE member_messages SET status = 'delivered', delivered_at = now(), delivered_run_id = $1
     WHERE status = 'queued'
       AND (run_id = $1 OR (urgency = 'now' AND run_id = $2))
       AND ($3::boolean IS FALSE OR urgency = 'now')
     RETURNING *`,
    [runId, topRunId, urgentOnly],
  );
  return inOrder(rows);
}

export async function setMemberMessageStatus(
  db: Queryable,
  ids: readonly string[],
  status: Extract<MemberMessageStatus, 'queued' | 'interrupting'>,
): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `UPDATE member_messages SET status = $2,
       delivered_at = CASE WHEN $2 = 'queued' THEN NULL ELSE delivered_at END
     WHERE id = ANY($1::uuid[])`,
    [ids, status],
  );
}

export async function markMissedMessages(db: Queryable, runId: string): Promise<void> {
  await db.query(
    `UPDATE member_messages SET status = 'missed'
     WHERE run_id = $1 AND status = 'queued' AND urgency = 'next'`,
    [runId],
  );
}

export async function urgentLeftovers(
  db: Queryable,
  conversationId: string,
): Promise<MemberMessage[]> {
  const { rows } = await db.query<MemberMessageRow>(
    `SELECT m.* FROM member_messages m JOIN runs r ON r.id = m.run_id
     WHERE m.conversation_id = $1 AND m.message_id IS NULL
       AND (m.status = 'interrupting'
         OR (m.status = 'queued' AND (m.urgency = 'now' OR r.parent_run_id IS NULL)
           AND r.status NOT IN ('queued', 'running', 'awaiting_approval')))
     ORDER BY m.created_at, m.id
     FOR UPDATE OF m`,
    [conversationId],
  );
  return rows.map(toMemberMessage);
}

export async function markMessageSent(
  db: Queryable,
  id: string,
  status: Extract<MemberMessageStatus, 'sent' | 'continued'>,
  messageId: string,
): Promise<void> {
  await db.query('UPDATE member_messages SET status = $2, message_id = $3 WHERE id = $1', [
    id,
    status,
    messageId,
  ]);
}
