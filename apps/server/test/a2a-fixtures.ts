import { randomUUID } from 'node:crypto';
import type { RunStatus } from '@spark-outpost/contracts';
import { createConversation } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import type { TestDb } from './support.ts';

export async function chatRow(t: TestDb): Promise<string> {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

export async function setRunStatus(db: Db, runId: string, status: RunStatus): Promise<void> {
  await db.query('UPDATE runs SET status = $2 WHERE id = $1', [runId, status]);
}

export async function replyRow(db: Db, runId: string, content: string): Promise<void> {
  await db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     SELECT $1, conversation_id, 'assistant', $3, id FROM runs WHERE id = $2`,
    [randomUUID(), runId, content],
  );
}

export async function postColumns(db: Db, postId: string) {
  const { rows } = await db.query<{
    task_id: string | null;
    run_id: string | null;
    closed_state: string | null;
    closed_reason: string | null;
    from_user: boolean;
    from_conversation_id: string | null;
    body: string;
    to_handle: string | null;
    outpost_id: string;
  }>(
    `SELECT task_id, run_id, closed_state, closed_reason, from_user, from_conversation_id, body,
       to_handle, outpost_id
     FROM outpost_posts WHERE id = $1`,
    [postId],
  );
  return rows[0] ?? null;
}

export async function queueRows(db: Db, chatId: string) {
  const { rows } = await db.query<{ id: string; content: string; outpost_post_id: string | null }>(
    `SELECT id, content, outpost_post_id FROM chat_queue WHERE conversation_id = $1
     ORDER BY position, created_at, id`,
    [chatId],
  );
  return rows;
}

export async function startedRun(db: Db, postId: string): Promise<string> {
  const runId = (await postColumns(db, postId))?.run_id ?? null;
  if (runId === null) throw new Error('The request did not start a turn.');
  return runId;
}
