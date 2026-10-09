import { randomUUID } from 'node:crypto';
import type { RunStatus } from '@spark-outpost/contracts';
import { createConversation } from '../src/persistence/conversations.ts';
import { listen } from '../src/persistence/notifications.ts';
import type { NewPost } from '../src/outposts/ports.ts';
import { startChat, testDatabaseUrl, type TestDb } from './support.ts';

export async function newChat(t: TestDb): Promise<string> {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

export async function chatWithTurn(t: TestDb): Promise<{ conversationId: string; runId: string }> {
  return startChat(t, 'earlier work');
}

export async function setRun(t: TestDb, runId: string, status: RunStatus): Promise<void> {
  await t.db.query('UPDATE runs SET status = $2 WHERE id = $1', [runId, status]);
}

export async function reply(t: TestDb, runId: string, content: string): Promise<void> {
  await t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     SELECT $1, conversation_id, 'assistant', $2, id FROM runs WHERE id = $3`,
    [randomUUID(), content, runId],
  );
}

export async function carry(t: TestDb, postId: string, runId: string): Promise<void> {
  await t.db.query('UPDATE outpost_posts SET task_id = $2, run_id = $3 WHERE id = $1', [
    postId,
    randomUUID(),
    runId,
  ]);
}

export async function accept(t: TestDb, postId: string): Promise<string> {
  const taskId = randomUUID();
  await t.db.query(
    `WITH accepted AS (
       UPDATE outpost_posts SET task_id = $2 WHERE id = $1 RETURNING id, to_conversation_id, body
     )
     INSERT INTO chat_queue (id, conversation_id, position, content, outpost_post_id)
     SELECT id, to_conversation_id, 1, body, id FROM accepted`,
    [postId, taskId],
  );
  return taskId;
}

export function userRequest(
  outpostId: string,
  toConversationId: string,
  toHandle: string,
): NewPost {
  return {
    id: randomUUID(),
    outpostId,
    kind: 'request',
    body: `Question for @${toHandle}`,
    fromUser: true,
    toHandle,
    toConversationId,
  };
}

export async function outpostEvents(): Promise<{ seen: string[]; close(): Promise<void> }> {
  const seen: string[] = [];
  const listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
    const event = JSON.parse(payload) as { kind: string; outpostId?: string };
    if (event.kind === 'outpost_changed' && event.outpostId) seen.push(event.outpostId);
  });
  return { seen, close: () => listener.close() };
}
