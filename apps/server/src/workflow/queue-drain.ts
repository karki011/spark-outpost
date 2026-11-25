import type { QueuedMessage, SendNowOutcome } from '@spark-outpost/contracts';
import { validateQueuedAttachments } from '../persistence/queued-attachments.ts';
import { resolveRunTarget } from '../api/run-target.ts';
import { BadRequestError } from '../api/validation.ts';
import {
  addToQueue,
  assertMessageOwner,
  alreadySent,
  QueueError,
  takeQueued,
} from '../persistence/chat-queue.ts';
import { isOpenChatAsk, markChatAskDelivered } from '../persistence/chat-asks.ts';
import { chatSparkPaused, sparkPausedForChat } from '../persistence/spark-pause.ts';
import { sendInTransaction, type RunTarget } from '../persistence/conversations.ts';
import { markRuleRetry } from '../persistence/spark-rules.ts';
import { rememberRemoteMessage } from '../remote/run-mark.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import {
  getMemberMessage,
  insertMemberMessage,
  markMessageSent,
  missedMessage,
  removeMemberMessages,
  urgentLeftovers,
} from '../persistence/member-messages.ts';
import { chatTurn, notFollowUp } from '../persistence/chat-turns.ts';

export type ResolveTarget = (conversationId: string) => Promise<RunTarget>;
export type DrainOutcome = 'sent' | 'busy' | 'paused' | 'held' | 'archived' | 'empty';

const ACTIVE = `('queued', 'running', 'awaiting_approval')`;

async function activeTurn(db: Queryable, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM runs WHERE conversation_id = $1 AND ${chatTurn()}
       AND status IN ${ACTIVE}
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0]?.id ?? null;
}

async function lastTurnSucceeded(db: Queryable, conversationId: string): Promise<boolean> {
  const { rows } = await db.query<{ status: string }>(
    `SELECT status FROM runs WHERE conversation_id = $1 AND ${chatTurn()}
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  return !rows[0] || rows[0].status === 'succeeded';
}

interface LockedChat {
  archived: boolean;
}

async function lockChat(db: Queryable, conversationId: string): Promise<LockedChat | null> {
  const { rows } = await db.query<LockedChat>(
    'SELECT archived_at IS NOT NULL AS archived FROM conversations WHERE id = $1 FOR UPDATE',
    [conversationId],
  );
  return rows[0] ?? null;
}

async function lockConversation(db: Queryable, conversationId: string): Promise<boolean> {
  return (await lockChat(db, conversationId)) !== null;
}

function queuedSource(item: Pick<QueuedMessage, 'sparkRuleCardId' | 'origin'>) {
  if (item.sparkRuleCardId) return 'spark_rule';
  return item.origin ?? 'queue';
}

async function sendQueued(
  db: Queryable,
  conversationId: string,
  item: Pick<
    QueuedMessage,
    'id' | 'content' | 'sparkRuleCardId' | 'origin' | 'attachmentIds' | 'annotations'
  >,
  target: RunTarget,
): Promise<void> {
  const sent = await sendInTransaction(
    db,
    conversationId,
    {
      id: item.id,
      content: item.content,
      attachmentIds: item.attachmentIds ?? [],
      annotations: item.annotations ?? [],
      source: queuedSource(item),
    },
    target,
  );
  if (item.sparkRuleCardId) await markRuleRetry(db, item.sparkRuleCardId, sent.run.id);
  if (item.origin === 'chat') await markChatAskDelivered(db, item.id, 'turn', sent.run.id);
}

export async function drainQueue(
  db: Db,
  conversationId: string,
  resolveTarget: ResolveTarget,
): Promise<DrainOutcome> {
  const target = await resolveTarget(conversationId);
  return withTransaction(db, async (client) => {
    const chat = await lockChat(client, conversationId);
    if (!chat) return 'empty';
    if (chat.archived) return 'archived';
    if (await activeTurn(client, conversationId)) return 'busy';
    if (await chatSparkPaused(client, conversationId)) return 'held';
    const urgent = (await urgentLeftovers(client, conversationId))[0];
    if (urgent) {
      const source = (await isOpenChatAsk(client, urgent.id)) ? 'chat' : 'queue';
      const sent = await sendInTransaction(
        client,
        conversationId,
        {
          id: urgent.id,
          content: urgent.body,
          source,
          attachmentIds: urgent.attachmentIds ?? [],
          annotations: urgent.annotations ?? [],
        },
        target,
      );
      await markMessageSent(client, urgent.id, 'sent', urgent.id);
      if (source === 'chat') await markChatAskDelivered(client, urgent.id, 'turn', sent.run.id);
      return 'sent';
    }
    if (!(await lastTurnSucceeded(client, conversationId))) return 'paused';
    const next = await takeQueued(client, conversationId, null);
    if (!next) return 'empty';
    await sendQueued(client, conversationId, next, target);
    return 'sent';
  });
}

export interface SendNowRequest {
  id: string;
  content?: string;
  attachmentIds?: readonly string[] | undefined;
  annotations?: QueuedMessage['annotations'];
  origin?: QueuedMessage['origin'];
}

const STEER_REFUSALS: Record<NonNullable<QueuedMessage['origin']>, string> = {
  assistant: 'A message from Ask Spark starts when this chat is free.',
  pages: 'A question about your tabs starts when Ask Spark is free.',
  voice: 'A spoken message starts when this chat is free.',
  chat: 'A message from another chat starts when this chat is free.',
  workflow: 'A workflow’s report starts when this chat is free.',
};

export async function sendNow(
  db: Db,
  conversationId: string,
  request: SendNowRequest,
  resolveTarget: ResolveTarget,
): Promise<SendNowOutcome | null> {
  const target = await resolveTarget(conversationId);
  return withTransaction(db, async (client) => {
    if (!(await lockConversation(client, conversationId))) return null;
    await assertMessageOwner(client, conversationId, request.id);
    if (await getMemberMessage(client, request.id)) return 'steering';
    if (await alreadySent(client, request.id)) return 'sent';
    const queued = await takeQueued(client, conversationId, request.id);
    const content = queued?.content ?? request.content;
    if (content === undefined) return null;
    const attachmentIds = queued?.attachmentIds ?? request.attachmentIds;
    const annotations = queued?.annotations ?? request.annotations;
    await validateQueuedAttachments(client, conversationId, request.id, attachmentIds, annotations);
    const running = await activeTurn(client, conversationId);
    const origin = queued?.origin ?? request.origin;
    if (origin && running) throw new QueueError(409, STEER_REFUSALS[origin]);
    if (queued?.sparkRuleCardId && running) {
      throw new QueueError(409, 'A retry from a Spark rules card starts when this chat is free.');
    }
    if (!running) {
      await sendQueued(
        client,
        conversationId,
        {
          id: request.id,
          content,
          ...(queued?.sparkRuleCardId ? { sparkRuleCardId: queued.sparkRuleCardId } : {}),
          ...(origin ? { origin } : {}),
          attachmentIds: attachmentIds ? [...attachmentIds] : undefined,
          annotations,
        },
        target,
      );
      return 'sent';
    }
    await insertMemberMessage(client, {
      id: request.id,
      conversationId,
      runId: running,
      body: content,
      urgency: 'now',
      attachmentIds,
      annotations,
    });
    await assertMessageOwner(client, conversationId, request.id);
    await rememberRemoteMessage(client, request.id);
    return 'steering';
  });
}

const LAST_TURN_FLOWS = `COALESCE((
  SELECT r.status FROM runs r WHERE r.conversation_id = q.conversation_id AND ${chatTurn('r')}
  ORDER BY r.created_at DESC LIMIT 1
), 'succeeded') = 'succeeded'`;

export async function waitingQueues(db: Queryable, limit = 20): Promise<string[]> {
  const { rows } = await db.query<{ conversation_id: string }>(
    `SELECT c.conversation_id FROM (
       SELECT q.conversation_id, q.created_at FROM chat_queue q
       WHERE ${LAST_TURN_FLOWS}
       UNION ALL
       SELECT m.conversation_id, m.created_at FROM member_messages m
       JOIN runs target ON target.id = m.run_id
       WHERE m.message_id IS NULL
         AND (m.status = 'interrupting'
           OR (m.status = 'queued' AND (m.urgency = 'now' OR target.parent_run_id IS NULL)))
         AND ${notFollowUp('target')}
     ) c
     JOIN conversations chat ON chat.id = c.conversation_id AND chat.archived_at IS NULL
     WHERE NOT ${sparkPausedForChat('c.conversation_id')}
     AND NOT EXISTS (
       SELECT 1 FROM runs r WHERE r.conversation_id = c.conversation_id
         AND ${chatTurn('r')} AND r.status IN ${ACTIVE}
     )
     GROUP BY c.conversation_id
     ORDER BY min(c.created_at)
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => row.conversation_id);
}

async function lastProvider(db: Queryable, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ provider: string }>(
    `SELECT provider FROM runs WHERE conversation_id = $1 AND ${chatTurn()}
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0]?.provider ?? null;
}

export function chatTarget(db: Db): ResolveTarget {
  return async (conversationId) => {
    const { rows } = await db.query<{ workspace_id: string }>(
      'SELECT workspace_id FROM conversations WHERE id = $1',
      [conversationId],
    );
    const workspaceId = rows[0]?.workspace_id;
    if (!workspaceId) throw new BadRequestError('That chat does not exist.');
    try {
      return await resolveRunTarget({ db, workspaceId }, conversationId);
    } catch (error) {
      const provider = await lastProvider(db, conversationId);
      if (!(error instanceof BadRequestError) || !provider) throw error;
      return { provider };
    }
  };
}

export async function drainWaiting(db: Db, resolveTarget: ResolveTarget): Promise<number> {
  let sent = 0;
  for (const conversationId of await waitingQueues(db)) {
    const outcome = await drainQueue(db, conversationId, resolveTarget).catch((error: unknown) => {
      console.error(`Could not send the queued message for chat ${conversationId}`, error);
      return 'empty' as const;
    });
    if (outcome === 'sent') sent += 1;
  }
  return sent;
}

export async function resendMissed(
  db: Db,
  conversationId: string,
  id: string,
  resolveTarget: ResolveTarget,
): Promise<'sent' | 'queued' | null> {
  const target = await resolveTarget(conversationId);
  return withTransaction(db, async (client) => {
    if (!(await lockConversation(client, conversationId))) return null;
    const missed = await missedMessage(client, conversationId, id);
    if (!missed) return null;
    await removeMemberMessages(client, [id]);
    if (await activeTurn(client, conversationId)) {
      await addToQueue(client, conversationId, {
        id,
        content: missed.body,
        attachmentIds: missed.attachmentIds,
        annotations: missed.annotations,
      });
      return 'queued';
    }
    const item = {
      id,
      content: missed.body,
      attachmentIds: missed.attachmentIds,
      annotations: missed.annotations,
    };
    await sendQueued(client, conversationId, item, target);
    return 'sent';
  });
}
