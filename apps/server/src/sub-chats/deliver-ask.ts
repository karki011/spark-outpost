import type { ChatAsk, ChatAskDelivered } from '@spark-outpost/contracts';
import { addToQueue, alreadySent, QueueError } from '../persistence/chat-queue.ts';
import { getChatAsk } from '../persistence/chat-asks.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { insertMemberMessage } from '../persistence/member-messages.ts';
import { drainQueue, type ResolveTarget } from '../workflow/queue-drain.ts';

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
    const running = ask.kind === 'wrap_up' ? null : await activeTurn(client, ask.to.id);
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

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
