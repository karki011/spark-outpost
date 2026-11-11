import { randomUUID } from 'node:crypto';
import { createConversation } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import type { TestDb } from './support.ts';

export async function createOutpostRow(t: TestDb, name = 'Orders launch'): Promise<string> {
  const id = randomUUID();
  await t.db.query('INSERT INTO outposts (id, workspace_id, name) VALUES ($1, $2, $3)', [
    id,
    t.workspaceId,
    name,
  ]);
  return id;
}

export async function addMemberChat(t: TestDb, outpostId: string, handle: string): Promise<string> {
  const conversationId = randomUUID();
  await createConversation(t.db, t.workspaceId, conversationId);
  await t.db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     SELECT $1, $2, $3, COALESCE(MAX(position), 0) + 1 FROM outpost_members WHERE outpost_id = $1`,
    [outpostId, conversationId, handle],
  );
  return conversationId;
}

const DEFAULT_REQUEST = 'What does the orders endpoint return?';

export interface RequestRow {
  outpostId: string;
  toConversationId: string;
  toHandle: string;
  body?: string;
  fromUser?: boolean;
}

export async function insertRequestRow(db: Db, request: RequestRow): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO outpost_posts
       (id, outpost_id, kind, body, from_user, to_handle, to_conversation_id)
     VALUES ($1, $2, 'request', $3, $4, $5, $6)`,
    [
      id,
      request.outpostId,
      request.body ?? DEFAULT_REQUEST,
      request.fromUser ?? true,
      request.toHandle,
      request.toConversationId,
    ],
  );
  return id;
}

export async function acceptRequestRow(db: Db, postId: string): Promise<void> {
  await db.query('UPDATE outpost_posts SET task_id = $2 WHERE id = $1', [postId, randomUUID()]);
  await db.query(
    `INSERT INTO chat_queue (id, conversation_id, position, content, outpost_post_id)
     SELECT post.id, post.to_conversation_id,
            COALESCE((SELECT MAX(position) FROM chat_queue
                      WHERE conversation_id = post.to_conversation_id), 0) + 1,
            post.body, post.id
     FROM outpost_posts post WHERE post.id = $1`,
    [postId],
  );
}

export async function deliverRequest(db: Db, request: RequestRow): Promise<string> {
  const postId = await insertRequestRow(db, request);
  await acceptRequestRow(db, postId);
  return postId;
}

export async function pauseOutpost(db: Db, outpostId: string, paused: boolean): Promise<void> {
  await db.query('UPDATE outposts SET paused_at = CASE WHEN $2 THEN now() END WHERE id = $1', [
    outpostId,
    paused,
  ]);
}

export async function finishRun(
  db: Db,
  runId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  reply?: string,
): Promise<void> {
  await db.query('UPDATE runs SET status = $2, finished_at = now() WHERE id = $1', [runId, status]);
  await db.query(`UPDATE jobs SET status = 'done' WHERE run_id = $1`, [runId]);
  if (reply === undefined) return;
  await db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     SELECT $2, conversation_id, 'assistant', $3, id FROM runs WHERE id = $1`,
    [runId, randomUUID(), reply],
  );
}

export async function postRunId(db: Db, postId: string): Promise<string | null> {
  const { rows } = await db.query<{ run_id: string | null }>(
    'SELECT run_id FROM outpost_posts WHERE id = $1',
    [postId],
  );
  return rows[0]?.run_id ?? null;
}

export interface TurnRow {
  id: string;
  source: string | null;
  status: string;
  user_message_id: string;
}

export async function chatTurns(db: Db, conversationId: string): Promise<TurnRow[]> {
  const { rows } = await db.query<TurnRow>(
    `SELECT id, source, status, user_message_id FROM runs
     WHERE conversation_id = $1 AND parent_run_id IS NULL ORDER BY created_at, id`,
    [conversationId],
  );
  return rows;
}
