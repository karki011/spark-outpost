import type { ChatAsk, ChatAskDelivery, ChatAskKind, ChatAskState } from '@spark-outpost/contracts';
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
  created_at: Date;
  settled_at: Date | null;
}

const SELECT_ASK = `SELECT a.id, a.kind, a.from_conversation_id, a.from_run_id,
    COALESCE(sender.title, a.from_title) AS from_title, a.to_conversation_id,
    receiver.title AS to_title, a.body, a.reply_to, a.state, a.delivered_as, a.run_id,
    a.no_reply_reason, a.created_at, a.settled_at
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
       to_conversation_id, body, reply_to, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
