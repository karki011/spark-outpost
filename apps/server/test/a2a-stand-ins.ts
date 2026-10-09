import { randomUUID } from 'node:crypto';
import {
  needsYouLines,
  type ClosedState,
  type OutpostAnswer,
  type OutpostPostKind,
  type RequestFacts,
  type RunStatus,
} from '@spark-outpost/contracts';
import type { ReadAnswer } from '../src/a2a/request-handler.ts';
import type { PostStore, PostWithFacts, StoredPost } from '../src/outposts/ports.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import type { Db, Queryable } from '../src/persistence/db.ts';
import type { TestDb } from './support.ts';

interface PostRow {
  id: string;
  outpost_id: string;
  kind: OutpostPostKind;
  body: string;
  from_user: boolean;
  from_conversation_id: string | null;
  from_run_id: string | null;
  request_hash: string | null;
  waits: boolean;
  from_handle: string | null;
  to_handle: string | null;
  to_conversation_id: string | null;
  guest: boolean;
  batch_id: string | null;
  task_id: string | null;
  run_id: string | null;
  closed_state: ClosedState | null;
  closed_reason: string | null;
  closed_at: Date | null;
  answer_seen_at: Date | null;
  pinned_at: Date | null;
  created_at: Date;
}

function toStored(row: PostRow): StoredPost {
  return {
    id: row.id,
    outpostId: row.outpost_id,
    kind: row.kind,
    body: row.body,
    fromUser: row.from_user,
    fromConversationId: row.from_conversation_id,
    fromRunId: row.from_run_id,
    requestHash: row.request_hash,
    waits: row.waits,
    fromHandle: row.from_handle,
    toHandle: row.to_handle,
    toConversationId: row.to_conversation_id,
    guest: row.guest,
    batchId: row.batch_id,
    taskId: row.task_id,
    runId: row.run_id,
    closedState: row.closed_state,
    closedReason: row.closed_reason,
    closedAt: row.closed_at?.toISOString() ?? null,
    observed: [],
    answerSeenAt: row.answer_seen_at?.toISOString() ?? null,
    pinnedAt: row.pinned_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

async function lastReply(db: Queryable, runId: string): Promise<string | null> {
  const { rows } = await db.query<{ content: string }>(
    `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`,
    [runId],
  );
  return rows[0]?.content ?? null;
}

async function standInFacts(db: Queryable, post: StoredPost): Promise<RequestFacts> {
  const { rows } = await db.query<{
    queued: boolean;
    run_status: RunStatus | null;
    paused: boolean;
    last_status: RunStatus | null;
  }>(
    `SELECT EXISTS (SELECT 1 FROM chat_queue q WHERE q.outpost_post_id = p.id) AS queued,
       (SELECT r.status FROM runs r WHERE r.id = p.run_id) AS run_status,
       o.paused_at IS NOT NULL AS paused,
       (SELECT r.status FROM runs r
        WHERE r.conversation_id = p.to_conversation_id AND r.parent_run_id IS NULL
        ORDER BY r.created_at DESC LIMIT 1) AS last_status
     FROM outpost_posts p JOIN outposts o ON o.id = p.outpost_id WHERE p.id = $1`,
    [post.id],
  );
  const row = rows[0]!;
  const reply =
    row.run_status === 'succeeded' && post.runId ? await lastReply(db, post.runId) : null;
  return {
    toHandle: post.toHandle ?? '',
    closedState: post.closedState,
    closedReason: post.closedReason,
    sent: post.taskId !== null,
    queued: row.queued,
    runStatus: row.run_status,
    runNeedsYou: reply === null ? null : (needsYouLines(reply)[0] ?? null),
    paused: row.paused,
    held: row.last_status !== null && row.last_status !== 'succeeded',
    chatDeleted: post.toConversationId === null,
  };
}

export const standInGetPost: PostStore['getPost'] = async (db, postId) => {
  const { rows } = await db.query<PostRow>('SELECT * FROM outpost_posts WHERE id = $1', [postId]);
  if (!rows[0]) return null;
  const post = toStored(rows[0]);
  const facts = post.kind === 'request' ? await standInFacts(db, post) : null;
  return { post, facts } satisfies PostWithFacts;
};

export const standInUnsentRequests: PostStore['unsentRequests'] = async (db) => {
  const { rows } = await db.query<PostRow>(
    `SELECT * FROM outpost_posts
     WHERE kind = 'request' AND task_id IS NULL AND closed_state IS NULL
     ORDER BY created_at, id`,
  );
  return rows.map(toStored);
};

export const standInReadAnswer: ReadAnswer = async (db, post) => {
  const text = post.runId === null ? null : await lastReply(db, post.runId);
  if (text === null) return null;
  return { text, branch: null, changes: [], pullRequests: [] } satisfies OutpostAnswer;
};

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
