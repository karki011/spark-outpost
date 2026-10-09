import { randomUUID } from 'node:crypto';
import type { RunStatus } from '@spark-outpost/contracts';
import { createConversation } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import type { TestDb } from './support.ts';

export async function outpostRow(t: TestDb, name = 'Orders launch'): Promise<string> {
  const id = randomUUID();
  await t.db.query('INSERT INTO outposts (id, workspace_id, name) VALUES ($1, $2, $3)', [
    id,
    t.workspaceId,
    name,
  ]);
  return id;
}

export async function chatRow(t: TestDb): Promise<string> {
  return (await createConversation(t.db, t.workspaceId, randomUUID())).id;
}

export async function memberChat(t: TestDb, outpostId: string, handle: string): Promise<string> {
  const chatId = await chatRow(t);
  await t.db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     VALUES ($1, $2, $3, (SELECT count(*) FROM outpost_members WHERE outpost_id = $1))`,
    [outpostId, chatId, handle],
  );
  return chatId;
}

export interface RequestRow {
  outpostId: string;
  toConversationId: string;
  toHandle: string;
  body?: string;
  fromUser?: boolean;
  guest?: boolean;
}

export async function requestRow(db: Db, request: RequestRow): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO outpost_posts
       (id, outpost_id, kind, body, from_user, to_handle, to_conversation_id, guest)
     VALUES ($1, $2, 'request', $3, $4, $5, $6, $7)`,
    [
      id,
      request.outpostId,
      request.body ?? 'What does the orders endpoint return?',
      request.fromUser ?? true,
      request.toHandle,
      request.toConversationId,
      request.guest ?? false,
    ],
  );
  return id;
}

export async function linkStartedRun(db: Db, postId: string): Promise<string | null> {
  const { rows } = await db.query<{ run_id: string }>(
    `UPDATE outpost_posts p SET run_id = r.id FROM runs r
     WHERE p.id = $1 AND r.user_message_id = p.id RETURNING p.run_id`,
    [postId],
  );
  return rows[0]?.run_id ?? null;
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
