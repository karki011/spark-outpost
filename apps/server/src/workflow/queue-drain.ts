import { PERMISSION_DO, type QueuedMessage, type SendNowOutcome } from '@spark-outpost/contracts';
import { resolveRunTarget } from '../api/run-target.ts';
import { BadRequestError } from '../api/validation.ts';
import { alreadySent, takeQueued } from '../persistence/chat-queue.ts';
import { sendInTransaction, type RunTarget } from '../persistence/conversations.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { buildingInPieces } from '../persistence/piece-notes.ts';
import {
  getMemberMessage,
  insertMemberMessage,
  markMessageSent,
  urgentLeftovers,
} from '../persistence/member-messages.ts';

export type ResolveTarget = (conversationId: string) => Promise<RunTarget>;
export type DrainOutcome = 'sent' | 'busy' | 'paused' | 'empty';

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

async function sendQueued(
  db: Queryable,
  conversationId: string,
  item: Pick<QueuedMessage, 'id' | 'content' | 'continueRunId'>,
  target: RunTarget,
): Promise<void> {
  const continuing = item.continueRunId !== null && target.permission === PERMISSION_DO;
  await sendInTransaction(
    db,
    conversationId,
    {
      id: item.id,
      content: item.content,
      source: 'queue',
      ...(continuing ? { startAs: 'continue' as const } : {}),
    },
    target,
  );
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

export async function drainQueue(
  db: Db,
  conversationId: string,
  resolveTarget: ResolveTarget,
): Promise<DrainOutcome> {
  const target = await resolveTarget(conversationId);
  return withTransaction(db, async (client) => {
    if (!(await lockConversation(client, conversationId))) return 'empty';
    if (await activeTurn(client, conversationId)) return 'busy';
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
    if (!running) {
      await sendQueued(
        client,
        conversationId,
        { id: request.id, content, continueRunId: queued?.continueRunId ?? null },
        target,
      );
      return 'sent';
    }
    const toIntake = await buildingInPieces(client, running);
    await insertMemberMessage(client, {
      id: request.id,
      conversationId,
      runId: running,
      body: content,
      urgency: toIntake ? 'next' : 'now',
    });
    return 'steering';
  });
}

export async function waitingQueues(db: Queryable, limit = 20): Promise<string[]> {
  const { rows } = await db.query<{ conversation_id: string }>(
    `SELECT DISTINCT c.conversation_id FROM (
       SELECT conversation_id FROM chat_queue
       UNION
       SELECT m.conversation_id FROM member_messages m JOIN runs target ON target.id = m.run_id
       WHERE m.message_id IS NULL
         AND (m.status = 'interrupting'
           OR (m.status = 'queued' AND (m.urgency = 'now' OR target.parent_run_id IS NULL)))
     ) c
     WHERE NOT EXISTS (
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
