import {
  subChatReportSchema,
  type ChatAsk,
  type ChatAskDelivery,
  type ChatAskKind,
  type ChatAskState,
  type SubChatReport,
  type TerminalRunStatus,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { notifySubChatsChanged } from './sub-chats.ts';

export interface NewChatAsk {
  id: string;
  workspaceId: string;
  kind: ChatAskKind;
  fromConversationId: string | null;
  fromRunId: string | null;
  fromTitle: string;
  toConversationId: string;
  body: string;
  replyTo: string | null;
  wantsReply: boolean;
  report?: SubChatReport | null;
}

export type AskOutcome = { state: 'replied' } | { state: 'no_reply'; reason: string };

interface ChatAskRow {
  id: string;
  kind: ChatAskKind;
  from_conversation_id: string | null;
  from_run_id: string | null;
  from_title: string;
  to_conversation_id: string;
  to_title: string;
  body: string;
  reply_to: string | null;
  state: ChatAskState | null;
  delivered_as: ChatAskDelivery | null;
  run_id: string | null;
  no_reply_reason: string | null;
  report: unknown;
  created_at: Date;
  settled_at: Date | null;
}

const SELECT_ASK = `SELECT a.id, a.kind, a.from_conversation_id, a.from_run_id,
    COALESCE(sender.title, a.from_title) AS from_title, a.to_conversation_id,
    receiver.title AS to_title, a.body, a.reply_to, a.state, a.delivered_as, a.run_id,
    a.no_reply_reason, a.report, a.created_at, a.settled_at
  FROM chat_asks a
  JOIN conversations receiver ON receiver.id = a.to_conversation_id
  LEFT JOIN conversations sender ON sender.id = a.from_conversation_id`;

function toChatAsk(row: ChatAskRow): ChatAsk {
  return {
    id: row.id,
    kind: row.kind,
    from: { id: row.from_conversation_id, title: row.from_title },
    fromRunId: row.from_run_id,
    to: { id: row.to_conversation_id, title: row.to_title },
    body: row.body,
    replyTo: row.reply_to,
    state: row.state,
    deliveredAs: row.delivered_as,
    runId: row.run_id,
    noReplyReason: row.no_reply_reason,
    report: subChatReportSchema.safeParse(row.report).data ?? null,
    createdAt: row.created_at.toISOString(),
    settledAt: row.settled_at ? row.settled_at.toISOString() : null,
  };
}

interface AskEnds {
  from_conversation_id: string | null;
  to_conversation_id: string;
}

async function notifyBothChats(db: Queryable, ask: AskEnds): Promise<void> {
  await notifySubChatsChanged(db, ask.to_conversation_id);
  if (ask.from_conversation_id) await notifySubChatsChanged(db, ask.from_conversation_id);
}

async function changed(db: Queryable, update: string, values: readonly unknown[]) {
  const { rows } = await db.query<AskEnds>(
    `${update} RETURNING from_conversation_id, to_conversation_id`,
    [...values],
  );
  if (!rows[0]) return false;
  await notifyBothChats(db, rows[0]);
  return true;
}

export async function insertChatAsk(db: Queryable, ask: NewChatAsk): Promise<boolean> {
  return changed(
    db,
    `INSERT INTO chat_asks (id, workspace_id, kind, from_conversation_id, from_run_id, from_title,
       to_conversation_id, body, reply_to, state, report)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO NOTHING`,
    [
      ask.id,
      ask.workspaceId,
      ask.kind,
      ask.fromConversationId,
      ask.fromRunId,
      ask.fromTitle,
      ask.toConversationId,
      ask.body,
      ask.replyTo,
      ask.wantsReply ? 'waiting' : null,
      ask.report ? JSON.stringify(ask.report) : null,
    ],
  );
}

export async function getChatAsk(db: Queryable, id: string): Promise<ChatAsk | null> {
  const { rows } = await db.query<ChatAskRow>(`${SELECT_ASK} WHERE a.id = $1`, [id]);
  return rows[0] ? toChatAsk(rows[0]) : null;
}

export async function listChatAsks(db: Queryable, conversationId: string): Promise<ChatAsk[]> {
  const { rows } = await db.query<ChatAskRow>(
    `${SELECT_ASK} WHERE a.to_conversation_id = $1 OR a.from_conversation_id = $1
     ORDER BY a.created_at, a.id`,
    [conversationId],
  );
  return rows.map(toChatAsk);
}

export async function markChatAskDelivered(
  db: Queryable,
  id: string,
  deliveredAs: ChatAskDelivery,
  runId: string,
): Promise<boolean> {
  return changed(
    db,
    `UPDATE chat_asks SET delivered_as = $2, run_id = $3
     WHERE id = $1 AND delivered_as IS NULL`,
    [id, deliveredAs, runId],
  );
}

export async function settleChatAsk(
  db: Queryable,
  id: string,
  outcome: AskOutcome,
): Promise<boolean> {
  return changed(
    db,
    `UPDATE chat_asks SET state = $2, no_reply_reason = $3, settled_at = now()
     WHERE id = $1 AND state = 'waiting'`,
    [id, outcome.state, outcome.state === 'no_reply' ? outcome.reason : null],
  );
}

export async function chatAsksById(
  db: Queryable,
  ids: readonly string[],
): Promise<Map<string, ChatAsk>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<ChatAskRow>(`${SELECT_ASK} WHERE a.id = ANY($1::uuid[])`, [ids]);
  return new Map(rows.map((row) => [row.id, toChatAsk(row)]));
}

export async function isOpenChatAsk(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM chat_asks WHERE id = $1 AND delivered_as IS NULL AND settled_at IS NULL',
    [id],
  );
  return rowCount === 1;
}

const NOT_HANDED = `a.delivered_as IS NULL AND a.settled_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM chat_queue q WHERE q.id = a.id)
  AND NOT EXISTS (SELECT 1 FROM member_messages s WHERE s.id = a.id)
  AND NOT EXISTS (SELECT 1 FROM messages sent WHERE sent.id = a.id)`;

export async function undeliveredAskIds(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT a.id FROM chat_asks a WHERE ${NOT_HANDED} ORDER BY a.created_at, a.id`,
  );
  return rows.map((row) => row.id);
}

export async function latestReportAskFrom(
  db: Queryable,
  fromConversationId: string,
): Promise<ChatAsk | null> {
  const { rows } = await db.query<ChatAskRow>(
    `${SELECT_ASK} WHERE a.kind = 'report' AND a.from_conversation_id = $1
     ORDER BY a.created_at DESC, a.id DESC LIMIT 1`,
    [fromConversationId],
  );
  return rows[0] ? toChatAsk(rows[0]) : null;
}

export async function rewriteReportAsk(
  db: Queryable,
  id: string,
  read: SubChatReport,
  report: SubChatReport,
  body: string,
): Promise<boolean> {
  return changed(
    db,
    `UPDATE chat_asks a SET report = $2, body = CASE WHEN ${NOT_HANDED} THEN $3 ELSE a.body END
     WHERE a.id = $1 AND $4::jsonb @> a.report AND a.report @> ($4::jsonb - 'said'::text)`,
    [id, JSON.stringify(report), body, JSON.stringify(read)],
  );
}

export async function returnAskToWaiting(db: Queryable, id: string): Promise<boolean> {
  return changed(
    db,
    `UPDATE chat_asks SET delivered_as = NULL, run_id = NULL
     WHERE id = $1 AND settled_at IS NULL`,
    [id],
  );
}

export async function endUndeliveredAsk(db: Queryable, id: string, reason: string) {
  return changed(
    db,
    `UPDATE chat_asks SET state = CASE WHEN state = 'waiting' THEN 'no_reply' ELSE state END,
       no_reply_reason = $2, settled_at = now()
     WHERE id = $1 AND delivered_as IS NULL AND settled_at IS NULL`,
    [id, reason],
  );
}

export interface EndedAsk {
  ask: ChatAsk;
  runStatus: TerminalRunStatus | 'gone';
  error: string | null;
  reply: string;
  finalReply: string;
  steerOffset: number;
}

export async function waitingAsksWithEndedTurn(
  db: Queryable,
  kinds: readonly ChatAskKind[],
): Promise<EndedAsk[]> {
  const { rows } = await db.query<
    ChatAskRow & {
      run_status: EndedAsk['runStatus'];
      run_error: string | null;
      reply: string;
      final_reply: string;
      steer_offset: number;
    }
  >(
    `SELECT asks.*, COALESCE(r.status, 'gone') AS run_status, r.error AS run_error,
       COALESCE(said.content, '') AS reply,
       COALESCE(said.final_reply, said.content, '') AS final_reply,
       COALESCE((SELECT s.delivered_text_offset FROM member_messages s
                 WHERE s.id = asks.id AND s.delivered_run_id = asks.run_id), 0) AS steer_offset
     FROM (${SELECT_ASK}) asks
     LEFT JOIN runs r ON r.id = asks.run_id
     LEFT JOIN LATERAL (
       SELECT m.content, m.final_reply FROM messages m
       WHERE m.run_id = r.id AND m.role = 'assistant'
       ORDER BY m.created_at, m.id LIMIT 1
     ) said ON true
     WHERE asks.state = 'waiting' AND asks.delivered_as IS NOT NULL
       AND asks.kind = ANY($1::text[])
       AND (r.id IS NULL OR r.status NOT IN ('queued', 'running', 'awaiting_approval'))
     ORDER BY asks.created_at, asks.id`,
    [kinds],
  );
  return rows.map((row) => ({
    ask: toChatAsk(row),
    runStatus: row.run_status,
    error: row.run_error,
    reply: row.reply,
    finalReply: row.final_reply,
    steerOffset: row.steer_offset,
  }));
}

export interface MissedAsk {
  id: string;
  conversationId: string;
  body: string;
}

export async function missedSteeredAsks(db: Queryable): Promise<MissedAsk[]> {
  const { rows } = await db.query<{ id: string; conversation_id: string; body: string }>(
    `SELECT s.id, s.conversation_id, s.body FROM member_messages s
     JOIN chat_asks a ON a.id = s.id
     WHERE s.status = 'missed' AND s.message_id IS NULL AND a.settled_at IS NULL
     ORDER BY s.created_at, s.id`,
  );
  return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, body: row.body }));
}
