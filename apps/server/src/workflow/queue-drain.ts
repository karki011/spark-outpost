import { PERMISSION_DO, type QueuedMessage, type SendNowOutcome } from '@spark-outpost/contracts';
import { resolveRunTarget } from '../api/run-target.ts';
import { BadRequestError } from '../api/validation.ts';
import {
  alreadySent,
  PAUSED_OUTPOST_ITEM,
  QueueError,
  takePostedAfterStop,
  takeQueued,
  takeTypedRequest,
} from '../persistence/chat-queue.ts';
import { chatSparkPaused, sparkPausedForChat } from '../persistence/spark-pause.ts';
import { sendInTransaction, type RunTarget } from '../persistence/conversations.ts';
import { postAttachmentIds } from '../persistence/outpost-posts.ts';
import { markRuleRetry } from '../persistence/spark-rules.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import {
  getMemberMessage,
  insertMemberMessage,
  markMessageSent,
  urgentLeftovers,
} from '../persistence/member-messages.ts';

export type ResolveTarget = (conversationId: string) => Promise<RunTarget>;
export type DrainOutcome = 'sent' | 'busy' | 'paused' | 'held' | 'empty';

const ACTIVE = `('queued', 'running', 'awaiting_approval')`;

async function activeTurn(db: Queryable, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
       AND status IN ${ACTIVE}
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0]?.id ?? null;
}

async function lastTurnSucceeded(db: Queryable, conversationId: string): Promise<boolean> {
  const { rows } = await db.query<{ status: string }>(
    `SELECT status FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  return !rows[0] || rows[0].status === 'succeeded';
}

async function lockConversation(db: Queryable, conversationId: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM conversations WHERE id = $1 FOR UPDATE', [
    conversationId,
  ]);
  return rowCount === 1;
}

function queuedSource(item: Pick<QueuedMessage, 'outpostPostId' | 'sparkRuleCardId'>) {
  if (item.outpostPostId) return 'outpost';
  return item.sparkRuleCardId ? 'spark_rule' : 'queue';
}

async function sendQueued(
  db: Queryable,
  conversationId: string,
  item: Pick<
    QueuedMessage,
    'id' | 'content' | 'continueRunId' | 'outpostPostId' | 'sparkRuleCardId'
  >,
  target: RunTarget,
): Promise<void> {
  const continuing = item.continueRunId !== null && target.permission === PERMISSION_DO;
  const attachmentIds = item.outpostPostId ? await postAttachmentIds(db, item.outpostPostId) : [];
  const sent = await sendInTransaction(
    db,
    conversationId,
    {
      id: item.id,
      content: item.content,
      attachmentIds,
      source: queuedSource(item),
      ...(continuing ? { startAs: 'continue' as const } : {}),
    },
    target,
  );
  if (item.outpostPostId) {
    await db.query('UPDATE outpost_posts SET run_id = $2 WHERE id = $1 AND run_id IS NULL', [
      item.outpostPostId,
      sent.run.id,
    ]);
  }
  if (item.sparkRuleCardId) await markRuleRetry(db, item.sparkRuleCardId, sent.run.id);
  if (!item.continueRunId) return;
  await insertMemberMessage(db, {
    id: item.id,
    conversationId,
    runId: item.continueRunId,
    body: item.content,
    urgency: 'next',
    status: 'continued',
    messageId: item.id,
  });
}

async function sendTypedWhilePaused(
  db: Queryable,
  conversationId: string,
  typedPostId: string | undefined,
  target: RunTarget,
): Promise<DrainOutcome> {
  if (!typedPostId) return 'held';
  const flowing = await lastTurnSucceeded(db, conversationId);
  const typed = await takeTypedRequest(db, conversationId, typedPostId, flowing);
  if (!typed) return 'held';
  await sendQueued(db, conversationId, typed, target);
  return 'sent';
}

export async function drainQueue(
  db: Db,
  conversationId: string,
  resolveTarget: ResolveTarget,
  typedPostId?: string,
): Promise<DrainOutcome> {
  const target = await resolveTarget(conversationId);
  return withTransaction(db, async (client) => {
    if (!(await lockConversation(client, conversationId))) return 'empty';
    if (await activeTurn(client, conversationId)) return 'busy';
    if (await chatSparkPaused(client, conversationId)) {
      return sendTypedWhilePaused(client, conversationId, typedPostId, target);
    }
    const urgent = (await urgentLeftovers(client, conversationId))[0];
    if (urgent) {
      await sendInTransaction(
        client,
        conversationId,
        { id: urgent.id, content: urgent.body, source: 'queue' },
        target,
      );
      await markMessageSent(client, urgent.id, 'sent', urgent.id);
      return 'sent';
    }
    const flowing = await lastTurnSucceeded(client, conversationId);
    const next = flowing
      ? await takeQueued(client, conversationId, null)
      : await takePostedAfterStop(client, conversationId);
    if (!next) return flowing ? 'empty' : 'paused';
    await sendQueued(client, conversationId, next, target);
    return 'sent';
  });
}

async function refuseOutpostSendNow(db: Queryable, postId: string, busy: boolean): Promise<void> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM outpost_posts post JOIN outposts o ON o.id = post.outpost_id
     WHERE post.id = $1 AND o.paused_at IS NOT NULL`,
    [postId],
  );
  if (rowCount === 1) throw new QueueError(409, 'The outpost is paused.');
  if (busy) throw new QueueError(409, 'A request from an outpost starts when this chat is free.');
}

export interface SendNowRequest {
  id: string;
  content?: string;
}

export async function sendNow(
  db: Db,
  conversationId: string,
  request: SendNowRequest,
  resolveTarget: ResolveTarget,
): Promise<SendNowOutcome | null> {
  const target = await resolveTarget(conversationId);
  return withTransaction(db, async (client) => {
    if (!(await lockConversation(client, conversationId))) return null;
    if (await getMemberMessage(client, request.id)) return 'steering';
    if (await alreadySent(client, request.id)) return 'sent';
    const queued = await takeQueued(client, conversationId, request.id);
    const content = queued?.content ?? request.content;
    if (content === undefined) return null;
    const running = await activeTurn(client, conversationId);
    if (queued?.outpostPostId)
      await refuseOutpostSendNow(client, queued.outpostPostId, running !== null);
    if (!running) {
      await sendQueued(
        client,
        conversationId,
        {
          id: request.id,
          content,
          continueRunId: queued?.continueRunId ?? null,
          outpostPostId: queued?.outpostPostId ?? null,
          ...(queued?.sparkRuleCardId ? { sparkRuleCardId: queued.sparkRuleCardId } : {}),
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
    });
    return 'steering';
  });
}

export async function waitingQueues(db: Queryable, limit = 20): Promise<string[]> {
  const { rows } = await db.query<{ conversation_id: string }>(
    `SELECT DISTINCT c.conversation_id FROM (
       SELECT q.conversation_id FROM chat_queue q WHERE NOT ${PAUSED_OUTPOST_ITEM}
       UNION
       SELECT m.conversation_id FROM member_messages m JOIN runs target ON target.id = m.run_id
       WHERE m.message_id IS NULL
         AND (m.status = 'interrupting'
           OR (m.status = 'queued' AND (m.urgency = 'now' OR target.parent_run_id IS NULL)))
     ) c
     WHERE NOT ${sparkPausedForChat('c.conversation_id')}
     AND NOT EXISTS (
       SELECT 1 FROM runs r WHERE r.conversation_id = c.conversation_id
         AND r.parent_run_id IS NULL AND r.status IN ${ACTIVE}
     )
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => row.conversation_id);
}

async function lastProvider(db: Queryable, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ provider: string }>(
    `SELECT provider FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
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
