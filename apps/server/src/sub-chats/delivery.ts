import type { AppEvent, ChatAsk, ChatAskDelivered } from '@spark-outpost/contracts';
import { addToQueue, alreadySent, QueueError } from '../persistence/chat-queue.ts';
import {
  getChatAsk,
  missedSteeredAsks,
  returnAskToWaiting,
  undeliveredAskIds,
  waitingAsksWithEndedTurn,
  type EndedAsk,
  type MissedAsk,
} from '../persistence/chat-asks.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { insertMemberMessage, removeMemberMessages } from '../persistence/member-messages.ts';
import { chatTarget, drainQueue, type ResolveTarget } from '../workflow/queue-drain.ts';
import { auditAskEnd, endNoReply, NO_REPLY_REASONS, recordReply } from './asks.ts';
import { TAKEN_FROM_TURN } from './message-prompt.ts';

type Handed = 'steered' | 'queued' | 'started' | 'closed';

async function activeTurn(db: Queryable, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL
       AND status IN ('queued', 'running', 'awaiting_approval')
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0]?.id ?? null;
}

async function exists(db: Queryable, table: 'chat_queue' | 'member_messages', id: string) {
  const { rowCount } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  return rowCount === 1;
}

async function hand(db: Db, askId: string): Promise<{ ask: ChatAsk; handed: Handed } | null> {
  const found = await getChatAsk(db, askId);
  if (!found) return null;
  return withTransaction(db, async (client) => {
    await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [found.to.id]);
    const ask = await getChatAsk(client, askId);
    if (!ask) return null;
    if (await alreadySent(client, ask.id)) return { ask, handed: 'started' };
    if (ask.deliveredAs !== null || ask.settledAt !== null) return { ask, handed: 'closed' };
    if (await exists(client, 'member_messages', ask.id)) return { ask, handed: 'steered' };
    if (await exists(client, 'chat_queue', ask.id)) return { ask, handed: 'queued' };
    const running = await activeTurn(client, ask.to.id);
    if (running) {
      await insertMemberMessage(client, {
        id: ask.id,
        conversationId: ask.to.id,
        runId: running,
        body: ask.body,
        urgency: 'now',
      });
      return { ask, handed: 'steered' };
    }
    await addToQueue(client, ask.to.id, { id: ask.id, content: ask.body, origin: 'chat' });
    return { ask, handed: 'queued' };
  });
}

export async function deliverAsk(
  db: Db,
  askId: string,
  resolveTarget: ResolveTarget,
): Promise<ChatAskDelivered> {
  let handed: { ask: ChatAsk; handed: Handed } | null;
  try {
    handed = await hand(db, askId);
  } catch (error) {
    if (error instanceof QueueError) return 'queued';
    throw error;
  }
  if (!handed) return 'queued';
  if (handed.handed === 'closed') return handed.ask.deliveredAs === 'steer' ? 'steered' : 'started';
  if (handed.handed !== 'queued') return handed.handed;
  await drainQueue(db, handed.ask.to.id, resolveTarget).catch((error: unknown) =>
    console.error(`A message between chats waits in its queue (${errorName(error)}).`),
  );
  return (await alreadySent(db, askId)) ? 'started' : 'queued';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

async function requeue(db: Db, missed: MissedAsk): Promise<void> {
  await withTransaction(db, async (client) => {
    await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [
      missed.conversationId,
    ]);
    await removeMemberMessages(client, [missed.id]);
    await returnAskToWaiting(client, missed.id);
    await addToQueue(
      client,
      missed.conversationId,
      { id: missed.id, content: missed.body, origin: 'chat' },
      'front',
    );
  });
}

function turnReply(ended: EndedAsk): string {
  if (ended.ask.deliveredAs === 'turn') return ended.finalReply.trim();
  const tail = ended.reply.slice(ended.steerOffset).trim();
  return tail ? `${tail}\n\n${TAKEN_FROM_TURN}` : '';
}

function noReplyReason(ended: EndedAsk): string {
  if (ended.runStatus === 'gone') return NO_REPLY_REASONS.gone;
  if (ended.runStatus === 'cancelled') return NO_REPLY_REASONS.stopped;
  return ended.runStatus === 'succeeded' ? NO_REPLY_REASONS.empty : NO_REPLY_REASONS.failed;
}

async function settle(db: Db, ended: EndedAsk): Promise<void> {
  const reply = ended.runStatus === 'succeeded' ? turnReply(ended) : '';
  if (reply) {
    const end = await recordReply(db, ended.ask, { fromRunId: ended.ask.runId, body: reply });
    if (end.settled) {
      const how = ended.ask.deliveredAs === 'turn' ? 'turn reply' : 'taken from its turn';
      await auditAskEnd(db, ended.ask, 'reply', how);
    }
    return;
  }
  const reason = noReplyReason(ended);
  const end = await endNoReply(db, ended.ask, reason);
  if (end.settled) await auditAskEnd(db, ended.ask, 'no_reply', reason);
}

async function each<T>(failure: string, items: readonly T[], step: (item: T) => Promise<unknown>) {
  for (const item of items) {
    try {
      await step(item);
    } catch (error) {
      console.error(`${failure} (${errorName(error)}).`);
    }
  }
}

export async function deliveryPass(db: Db, resolveTarget: ResolveTarget): Promise<void> {
  await each('A missed message between chats was not queued', await missedSteeredAsks(db), (ask) =>
    requeue(db, ask),
  );
  await each(
    'A message between chats was not settled',
    await waitingAsksWithEndedTurn(db, ['message']),
    (ended) => settle(db, ended),
  );
  await each('A message between chats was not delivered', await undeliveredAskIds(db), (id) =>
    deliverAsk(db, id, resolveTarget),
  );
}

export interface AskDelivery {
  changed(event: AppEvent): void;
  close(): Promise<void>;
}

const WAKES: ReadonlySet<AppEvent['kind']> = new Set(['sub_chats_changed', 'run', 'spark_pause']);

export function askDelivery(db: Db, resolveTarget: ResolveTarget = chatTarget(db)): AskDelivery {
  let running: Promise<void> | null = null;
  let again = false;
  let closed = false;

  async function passes(): Promise<void> {
    do {
      again = false;
      await deliveryPass(db, resolveTarget).catch((error: unknown) =>
        console.error(`Messages between chats were not delivered (${errorName(error)}).`),
      );
    } while (again && !closed);
    running = null;
  }

  function wake(): void {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = passes();
  }

  wake();
  return {
    changed(event) {
      if (WAKES.has(event.kind)) wake();
    },
    async close() {
      closed = true;
      await running;
    },
  };
}
