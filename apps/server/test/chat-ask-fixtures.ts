import { randomUUID } from 'node:crypto';
import { getChatAsk } from '../src/persistence/chat-asks.ts';
import { createMessageAsk } from '../src/sub-chats/asks.ts';
import type { TestDb } from './support.ts';

export const fakeTarget = async () => ({ provider: 'fake' });

export async function messageAsk(
  t: TestDb,
  from: { id: string; title: string },
  toConversationId: string,
  body: string,
  wantsReply = false,
): Promise<string> {
  const id = randomUUID();
  await createMessageAsk(t.db, {
    id,
    workspaceId: t.workspaceId,
    from,
    fromRunId: null,
    toConversationId,
    body,
    wantsReply,
  });
  return id;
}

export async function askNow(t: TestDb, id: string) {
  const ask = await getChatAsk(t.db, id);
  if (!ask) throw new Error(`Ask ${id} is gone.`);
  return ask;
}

export interface TurnRow {
  id: string;
  source: string | null;
  user_message_id: string | null;
  status: string;
  cancel_requested_at: Date | null;
}

export async function turnsOf(t: TestDb, conversationId: string): Promise<TurnRow[]> {
  const { rows } = await t.db.query<TurnRow>(
    `SELECT id, source, user_message_id, status, cancel_requested_at FROM runs
     WHERE conversation_id = $1 AND parent_run_id IS NULL ORDER BY created_at`,
    [conversationId],
  );
  return rows;
}

export async function finishTurn(
  t: TestDb,
  runId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  reply = '',
  finalReply: string | null = null,
): Promise<void> {
  await t.db.query('DELETE FROM jobs WHERE run_id = $1', [runId]);
  await t.db.query(
    `UPDATE runs SET status = $2, finished_at = now(),
       cancel_requested_at = CASE WHEN $2 = 'cancelled' THEN now() END
     WHERE id = $1`,
    [runId, status],
  );
  if (!reply) return;
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id, final_reply)
     SELECT $1, conversation_id, 'assistant', $3, id, $4 FROM runs WHERE id = $2`,
    [randomUUID(), runId, reply, finalReply],
  );
}
