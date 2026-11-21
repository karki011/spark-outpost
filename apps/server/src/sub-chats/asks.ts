import type { ChatAsk, ChatAskKind, ChatRef } from '@spark-outpost/contracts';
import { redactText, storableText } from '../audit/redact.ts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import {
  endUndeliveredAsk,
  getChatAsk,
  insertChatAsk,
  settleChatAsk,
} from '../persistence/chat-asks.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { clippedMessage, type AskPromptFacts } from './message-prompt.ts';

export const SEND_REFUSALS = {
  missing: 'That chat no longer exists.',
  self: 'A chat can’t send a message to itself.',
  terminal: 'Messages can’t be sent to a Terminal session.',
  assistant: 'Messages can’t be sent to Ask Spark’s chat.',
  hidden: 'That chat can’t take messages.',
  archived: 'That chat is archived, so it can’t take messages.',
  chain:
    'This turn was started by a message from another chat, so it can message only that chat. Tell the user if another chat needs to hear this.',
  parentChain:
    'This turn was started by a sub-chat, so it can message only this chat’s own sub-chats. Tell the user if another chat needs to hear this.',
  notForThisChat: 'That message was not sent to this chat, so this chat can’t answer it.',
  notWaiting: 'That message is no longer waiting for a reply.',
} as const;

export const NO_REPLY_REASONS = {
  failed: 'Its turn failed.',
  stopped: 'Its turn was stopped.',
  gone: 'Its turn is gone.',
  empty: 'Its turn ended without an answer.',
  removed: 'The message was removed from its queue.',
} as const;

export class AskError extends Error {}

export async function askPromptFacts(db: Queryable, ask: ChatAsk): Promise<AskPromptFacts> {
  const answers = ask.kind === 'reply' && ask.replyTo ? await getChatAsk(db, ask.replyTo) : null;
  return {
    id: ask.id,
    kind: ask.kind,
    fromTitle: ask.from.title,
    wantsReply: ask.state === 'waiting',
    noReply: ask.kind === 'reply' && answers?.state !== 'replied',
  };
}

export interface TargetChat {
  id: string;
  title: string;
  terminal: boolean;
  assistant: boolean;
  hidden: boolean;
  archived: boolean;
  ownSubChat: boolean;
}

export interface TurnStart {
  fromChatId: string | null;
  kind: ChatAskKind;
  fromOwnSubChat: boolean;
}

export interface SendFacts {
  fromChatId: string;
  to: TargetChat | null;
  startedBy: TurnStart | null;
  userAsked: boolean;
}

export type SendRule =
  { kind: 'refuse'; reason: string } | { kind: 'mode' } | { kind: 'asked' } | { kind: 'card' };

const COORDINATING: ReadonlySet<ChatAskKind> = new Set(['report', 'reply']);

export function coordinatesOwnSubChats(started: TurnStart): boolean {
  return started.fromOwnSubChat && COORDINATING.has(started.kind);
}

function refuse(reason: string): SendRule {
  return { kind: 'refuse', reason };
}

export function targetRefusal(fromChatId: string, to: TargetChat | null): string | null {
  if (!to) return SEND_REFUSALS.missing;
  if (to.id === fromChatId) return SEND_REFUSALS.self;
  if (to.terminal) return SEND_REFUSALS.terminal;
  if (to.assistant) return SEND_REFUSALS.assistant;
  if (to.hidden) return SEND_REFUSALS.hidden;
  if (to.archived) return SEND_REFUSALS.archived;
  return null;
}

export function sendRule(facts: SendFacts): SendRule {
  const refusal = targetRefusal(facts.fromChatId, facts.to);
  if (refusal || !facts.to) return refuse(refusal ?? SEND_REFUSALS.missing);
  const started = facts.startedBy;
  if (started) {
    if (started.fromChatId === facts.to.id) return { kind: 'mode' };
    const coordinates = coordinatesOwnSubChats(started);
    if (coordinates && facts.to.ownSubChat) return { kind: 'mode' };
    return refuse(coordinates ? SEND_REFUSALS.parentChain : SEND_REFUSALS.chain);
  }
  if (facts.to.ownSubChat) return { kind: 'mode' };
  return facts.userAsked ? { kind: 'asked' } : { kind: 'card' };
}

export async function targetChat(
  db: Queryable,
  workspaceId: string,
  fromChatId: string,
  toId: string,
): Promise<TargetChat | null> {
  const { rows } = await db.query<{
    title: string;
    terminal: boolean;
    assistant: boolean;
    hidden: boolean;
    archived: boolean;
    own_sub_chat: boolean;
  }>(
    `SELECT c.title, c.session_type = 'terminal' AS terminal, c.kind <> 'chat' AS hidden,
       c.archived_at IS NOT NULL AS archived,
       EXISTS (SELECT 1 FROM profiles pf
               WHERE pf.workspace_id = c.workspace_id AND pf.assistant_conversation_id = c.id)
         AS assistant,
       EXISTS (SELECT 1 FROM sub_chats s
               WHERE s.conversation_id = c.id AND s.parent_conversation_id = $3) AS own_sub_chat
     FROM conversations c WHERE c.id = $1 AND c.workspace_id = $2`,
    [toId, workspaceId, fromChatId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: toId,
    title: row.title,
    terminal: row.terminal,
    assistant: row.assistant,
    hidden: row.hidden,
    archived: row.archived,
    ownSubChat: row.own_sub_chat,
  };
}

export async function turnStart(db: Queryable, runId: string): Promise<TurnStart | null> {
  const { rows } = await db.query<{
    from_chat: boolean;
    from_conversation_id: string | null;
    kind: ChatAskKind | null;
    from_own_sub_chat: boolean;
  }>(
    `SELECT top.source = 'chat' AS from_chat, a.from_conversation_id, a.kind,
       EXISTS (SELECT 1 FROM sub_chats s
               WHERE s.conversation_id = a.from_conversation_id
                 AND s.parent_conversation_id = top.conversation_id) AS from_own_sub_chat
     FROM runs own
     JOIN runs top ON top.id = COALESCE(own.parent_run_id, own.id)
     LEFT JOIN chat_asks a ON a.id = top.user_message_id
     WHERE own.id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row?.from_chat) return null;
  return {
    fromChatId: row.from_conversation_id,
    kind: row.kind ?? 'message',
    fromOwnSubChat: row.from_own_sub_chat,
  };
}

export async function askTurnFacts(db: Queryable, messageId: string) {
  const ask = await getChatAsk(db, messageId);
  return ask ? askPromptFacts(db, ask) : null;
}

export function storedMessage(body: string): string {
  return clippedMessage(storableText(redactText(body)).trim());
}

export interface NewMessageAsk {
  id: string;
  workspaceId: string;
  from: ChatRef;
  fromRunId: string | null;
  toConversationId: string;
  body: string;
  wantsReply: boolean;
}

export function createMessageAsk(db: Queryable, ask: NewMessageAsk): Promise<boolean> {
  return insertChatAsk(db, {
    id: ask.id,
    workspaceId: ask.workspaceId,
    kind: 'message',
    fromConversationId: ask.from.id,
    fromRunId: ask.fromRunId,
    fromTitle: ask.from.title,
    toConversationId: ask.toConversationId,
    body: storedMessage(ask.body),
    replyTo: null,
    wantsReply: ask.wantsReply,
  });
}

export async function waitingAskFor(db: Queryable, askId: string, chatId: string) {
  const ask = await getChatAsk(db, askId);
  if (!ask || ask.to.id !== chatId) throw new AskError(SEND_REFUSALS.notForThisChat);
  if (ask.state !== 'waiting') throw new AskError(SEND_REFUSALS.notWaiting);
  return ask;
}

async function answerSender(
  db: Queryable,
  ask: ChatAsk,
  fromRunId: string | null,
  body: string,
): Promise<string | null> {
  if (ask.from.id === null) return null;
  const { rows } = await db.query<{ workspace_id: string }>(
    'SELECT workspace_id FROM conversations WHERE id = $1',
    [ask.from.id],
  );
  const workspaceId = rows[0]?.workspace_id;
  if (!workspaceId) return null;
  const id = newId();
  await insertChatAsk(db, {
    id,
    workspaceId,
    kind: 'reply',
    fromConversationId: ask.to.id,
    fromRunId,
    fromTitle: ask.to.title,
    toConversationId: ask.from.id,
    body: storedMessage(body),
    replyTo: ask.id,
    wantsReply: false,
  });
  return id;
}

export interface AskEnd {
  settled: boolean;
  replyId: string | null;
}

const NOT_SETTLED: AskEnd = { settled: false, replyId: null };

export function recordReply(
  db: Db,
  ask: ChatAsk,
  reply: { fromRunId: string | null; body: string },
): Promise<AskEnd> {
  return withTransaction(db, async (client) => {
    if (!(await settleChatAsk(client, ask.id, { state: 'replied' }))) return NOT_SETTLED;
    return { settled: true, replyId: await answerSender(client, ask, reply.fromRunId, reply.body) };
  });
}

async function endNoReplyIn(db: Queryable, ask: ChatAsk, reason: string): Promise<AskEnd> {
  const ended =
    ask.deliveredAs === null
      ? await endUndeliveredAsk(db, ask.id, reason)
      : await settleChatAsk(db, ask.id, { state: 'no_reply', reason });
  if (!ended) return NOT_SETTLED;
  if (ask.state !== 'waiting') return { settled: true, replyId: null };
  return { settled: true, replyId: await answerSender(db, ask, null, `No reply: ${reason}`) };
}

export function endNoReply(db: Db, ask: ChatAsk, reason: string): Promise<AskEnd> {
  return withTransaction(db, (client) => endNoReplyIn(client, ask, reason));
}

export async function endRemovedAsk(db: Queryable, askId: string): Promise<ChatAsk | null> {
  const ask = await getChatAsk(db, askId);
  if (!ask) return null;
  const end = await endNoReplyIn(db, ask, NO_REPLY_REASONS.removed);
  return end.settled ? ask : null;
}

export type AskAudit = 'reply' | 'no_reply';

export async function auditAskEnd(
  db: Db,
  ask: ChatAsk,
  event: AskAudit,
  how: string,
): Promise<void> {
  const runId = ask.runId ?? ask.fromRunId;
  if (!runId) return;
  const payload = { askId: ask.id, event, from: ask.from, to: ask.to, how };
  await insertFinishedRunEntries(db, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method: 'spark/chat_ask',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}
