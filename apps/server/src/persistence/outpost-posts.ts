import { z } from 'zod';
import {
  NEEDS_YOU_PREFIX,
  type ClosedState,
  type OutpostAnswer,
  type OutpostPostKind,
  type RejectReason,
  type RequestFacts,
  type RunStatus,
} from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import type { NewPost, PostStore, PostWithFacts, StoredPost } from '../outposts/ports.ts';
import { taskChanges } from '../projects/task-changes.ts';
import type { Queryable } from './db.ts';

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
  observed: unknown;
  answer_seen_at: Date | null;
  pinned_at: Date | null;
  created_at: Date;
}

interface FactsRow extends PostRow {
  paused: boolean;
  queued: boolean;
  held: boolean;
  run_status: RunStatus | null;
  run_needs_you: string | null;
}

const observedSchema = z.array(
  z.object({
    source: z.enum(['secret_file', 'secret_output', 'private_data', 'web_page']),
    label: z.string(),
  }),
);

const FACTS_QUERY = `
  SELECT p.*,
    (o.paused_at IS NOT NULL) AS paused,
    EXISTS (SELECT 1 FROM chat_queue q WHERE q.outpost_post_id = p.id) AS queued,
    COALESCE((
      SELECT last.status NOT IN ('succeeded', 'queued', 'running', 'awaiting_approval')
      FROM runs last
      WHERE last.conversation_id = p.to_conversation_id AND last.parent_run_id IS NULL
      ORDER BY last.created_at DESC LIMIT 1
    ), false) AS held,
    r.status AS run_status,
    CASE WHEN r.status = 'succeeded' THEN (
      SELECT substring(m.content from $needs$(?:^|\n\n)(${NEEDS_YOU_PREFIX}[^\n]*)$needs$)
      FROM messages m
      WHERE m.run_id = r.id AND m.role = 'assistant' ORDER BY m.created_at DESC LIMIT 1
    ) END AS run_needs_you
  FROM outpost_posts p
  JOIN outposts o ON o.id = p.outpost_id
  LEFT JOIN runs r ON r.id = p.run_id`;

function toPost(row: PostRow): StoredPost {
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
    observed: observedSchema.safeParse(row.observed).data ?? [],
    answerSeenAt: row.answer_seen_at?.toISOString() ?? null,
    pinnedAt: row.pinned_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function toFacts(row: FactsRow): RequestFacts | null {
  if (row.kind !== 'request') return null;
  return {
    toHandle: row.to_handle ?? '',
    closedState: row.closed_state,
    closedReason: row.closed_reason,
    sent: row.task_id !== null,
    queued: row.queued,
    runStatus: row.run_status,
    runNeedsYou: row.run_needs_you,
    paused: row.paused,
    held: row.held,
    chatDeleted: row.to_conversation_id === null,
  };
}

function withFacts(row: FactsRow): PostWithFacts {
  return { post: toPost(row), facts: toFacts(row) };
}

async function existingPost(db: Queryable, post: NewPost): Promise<StoredPost | null> {
  const { rows } = await db.query<PostRow>(
    `SELECT * FROM outpost_posts
     WHERE id = $1 OR (
       from_run_id = $2 AND to_conversation_id = $3 AND request_hash = $4
     )
     ORDER BY (id = $1) DESC LIMIT 1`,
    [post.id, post.fromRunId ?? null, post.toConversationId ?? null, post.requestHash ?? null],
  );
  return rows[0] ? toPost(rows[0]) : null;
}

async function insertPost(db: Queryable, post: NewPost): Promise<StoredPost> {
  const { rows } = await db.query<PostRow>(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_user, from_conversation_id,
       from_run_id, request_hash, waits, from_handle, to_handle, to_conversation_id, guest,
       batch_id, observed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      post.id,
      post.outpostId,
      post.kind,
      post.body,
      post.fromUser,
      post.fromConversationId ?? null,
      post.fromRunId ?? null,
      post.requestHash ?? null,
      post.waits ?? false,
      post.fromHandle ?? null,
      post.toHandle ?? null,
      post.toConversationId ?? null,
      post.guest ?? false,
      post.batchId ?? null,
      JSON.stringify(post.observed ?? []),
    ],
  );
  if (rows[0]) return toPost(rows[0]);
  const existing = await existingPost(db, post);
  if (!existing) throw new Error(`Outpost post ${post.id} was neither inserted nor found.`);
  return existing;
}

export const insertPosts: PostStore['insertPosts'] = async (db, posts) => {
  const stored: StoredPost[] = [];
  for (const post of posts) stored.push(await insertPost(db, post));
  return stored;
};

export const listPosts: PostStore['listPosts'] = async (db, outpostId) => {
  const { rows } = await db.query<FactsRow>(
    `${FACTS_QUERY} WHERE p.outpost_id = $1 ORDER BY p.created_at, p.id`,
    [outpostId],
  );
  return rows.map(withFacts);
};

export const getPost: PostStore['getPost'] = async (db, postId) => {
  const { rows } = await db.query<FactsRow>(`${FACTS_QUERY} WHERE p.id = $1`, [postId]);
  return rows[0] ? withFacts(rows[0]) : null;
};

export const closePost: PostStore['closePost'] = async (db, postId, closed) => {
  const { rowCount } = await db.query(
    `UPDATE outpost_posts SET closed_state = $2, closed_reason = $3, closed_at = now()
     WHERE id = $1 AND kind = 'request' AND closed_state IS NULL`,
    [postId, closed.state, closed.reason],
  );
  return rowCount === 1;
};

export async function cancelUnsent(db: Queryable, postId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE outpost_posts SET closed_state = 'cancelled', closed_at = now()
     WHERE id = $1 AND kind = 'request' AND closed_state IS NULL AND task_id IS NULL`,
    [postId],
  );
  return rowCount === 1;
}

export async function rejectWaiting(
  db: Queryable,
  outpostId: string,
  conversationId: string,
  reason: RejectReason,
): Promise<number> {
  const { rowCount } = await db.query(
    `WITH closed AS (
       UPDATE outpost_posts
       SET closed_state = 'rejected', closed_reason = $3, closed_at = now()
       WHERE outpost_id = $1 AND to_conversation_id = $2 AND kind = 'request'
         AND closed_state IS NULL AND run_id IS NULL
       RETURNING id
     ), unqueued AS (
       DELETE FROM chat_queue WHERE outpost_post_id IN (SELECT id FROM closed)
     )
     SELECT id FROM closed`,
    [outpostId, conversationId, reason],
  );
  return rowCount ?? 0;
}

export const unsentRequests: PostStore['unsentRequests'] = async (db) => {
  const { rows } = await db.query<PostRow>(
    `SELECT p.* FROM outpost_posts p JOIN outposts o ON o.id = p.outpost_id
     WHERE p.kind = 'request' AND p.task_id IS NULL AND p.closed_state IS NULL
       AND p.to_conversation_id IS NOT NULL AND o.paused_at IS NULL
     ORDER BY p.created_at, p.id`,
  );
  return rows.map(toPost);
};

interface AnswerRow {
  task_id: string | null;
  conversation_id: string;
  reply: string | null;
  branch: string | null;
  run_ids: string[];
  pull_requests: string[];
}

export interface AnswerOptions {
  maxChars?: number;
}

function answerText(reply: string | null, maxChars: number | undefined): string {
  const text = redactText(reply ?? '').trim();
  if (maxChars === undefined || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… (${text.length} chars)`;
}

async function changedPaths(
  db: Queryable,
  workspaceId: string,
  taskId: string | null,
  runIds: readonly string[],
): Promise<string[]> {
  if (taskId === null) return [];
  try {
    const { runs } = await taskChanges(db, workspaceId, taskId);
    const files = runs
      .filter((run) => !run.revertedAt && runIds.includes(run.runId))
      .flatMap((run) => run.files);
    return [...new Set(files.map((file) => file.path))];
  } catch {
    return [];
  }
}

export async function requestAnswer(
  db: Queryable,
  workspaceId: string,
  request: PostWithFacts,
  options: AnswerOptions = {},
): Promise<OutpostAnswer | null> {
  const { post, facts } = request;
  if (post.runId === null || post.closedState !== null || facts?.runStatus !== 'succeeded') {
    return null;
  }
  const { rows } = await db.query<AnswerRow>(
    `WITH RECURSIVE family AS (
       SELECT id FROM runs WHERE id = $1
       UNION ALL
       SELECT child.id FROM runs child JOIN family ON child.parent_run_id = family.id
     )
     SELECT r.task_id, r.conversation_id,
       (SELECT m.content FROM messages m
        WHERE m.run_id = r.id AND m.role = 'assistant'
        ORDER BY m.created_at DESC LIMIT 1) AS reply,
       (SELECT w.branch FROM chat_worktrees w
        WHERE w.conversation_id = r.conversation_id AND w.removed_at IS NULL
        ORDER BY w.created_at LIMIT 1) AS branch,
       ARRAY(SELECT id::text FROM family) AS run_ids,
       ARRAY(
         SELECT l.url FROM task_links l
         WHERE l.task_id = r.task_id AND l.kind = 'pr' AND l.created_at >= r.created_at
         ORDER BY l.created_at, l.id
       ) AS pull_requests
     FROM runs r WHERE r.id = $1`,
    [post.runId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    text: answerText(row.reply, options.maxChars),
    branch: row.branch,
    changes: await changedPaths(db, workspaceId, row.task_id, row.run_ids),
    pullRequests: row.pull_requests,
  };
}
