import { z } from 'zod';
import {
  NEEDS_YOU_PREFIX,
  needsYouLines,
  type ClosedState,
  type OutpostPostKind,
  type RejectReason,
  type RequestFacts,
  type RunStatus,
} from '@spark-outpost/contracts';
import type {
  HeldRequest,
  NewPost,
  PostStore,
  PostWithFacts,
  StoredPost,
} from '../outposts/ports.ts';
import { postedAfterStop } from './chat-queue.ts';
import type { Queryable } from './db.ts';
import { workReply } from './work-reply.ts';

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
  attachment_ids: string[];
  opening: boolean;
  after_post_id: string | null;
  user_started: boolean;
}

interface FactsRow extends PostRow {
  paused: boolean;
  queued: boolean;
  held: RequestFacts['held'];
  run_status: RunStatus | null;
  run_error: string | null;
  run_asking_reply: string | null;
  waiting_handle: string | null;
  waiting_deleted: boolean;
  waiting_failed: boolean;
  wrap_up: boolean;
}

const observedSchema = z.array(
  z.object({
    source: z.enum(['secret_file', 'secret_output', 'private_data', 'web_page', 'mac_app']),
    label: z.string(),
  }),
);

const FACTS_QUERY = `
  SELECT p.*,
    (o.paused_at IS NOT NULL) AS paused,
    EXISTS (SELECT 1 FROM chat_queue q WHERE q.outpost_post_id = p.id) AS queued,
    (
      SELECT CASE
        WHEN last.status IN ('succeeded', 'queued', 'running', 'awaiting_approval') THEN NULL
        WHEN ${postedAfterStop('p', 'last')} THEN NULL
        WHEN last.status = 'cancelled' THEN 'stopped'
        ELSE 'failed'
      END
      FROM runs last
      WHERE last.conversation_id = p.to_conversation_id AND last.parent_run_id IS NULL
      ORDER BY last.created_at DESC LIMIT 1
    ) AS held,
    r.status AS run_status,
    r.error AS run_error,
    CASE WHEN r.status = 'succeeded' THEN (
      SELECT CASE WHEN strpos(work.text, '${NEEDS_YOU_PREFIX}') > 0 THEN work.text END
      FROM (${workReply('r.id')}) work
    ) END AS run_asking_reply,
    CASE WHEN w.to_conversation_id IS NOT NULL THEN w.to_handle END AS waiting_handle,
    (w.id IS NOT NULL AND w.to_conversation_id IS NULL) AS waiting_deleted,
    COALESCE(
      w.closed_state IN ('failed', 'rejected')
        OR (w.closed_state IS NULL AND wr.status IN ('failed', 'outcome_unknown')),
      false
    ) AS waiting_failed,
    EXISTS (SELECT 1 FROM outpost_drafts wrap WHERE wrap.id = p.id) AS wrap_up
  FROM outpost_posts p
  JOIN outposts o ON o.id = p.outpost_id
  LEFT JOIN runs r ON r.id = p.run_id
  LEFT JOIN outpost_posts w ON w.id = p.after_post_id AND p.task_id IS NULL
  LEFT JOIN runs wr ON wr.id = w.run_id`;

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
    attachmentIds: row.attachment_ids,
    opening: row.opening,
    afterPostId: row.after_post_id,
    userStarted: row.user_started,
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
    runNeedsYou: needsYouLines(row.run_asking_reply ?? '')[0] ?? null,
    paused: row.paused,
    held: row.held,
    chatDeleted: row.to_conversation_id === null,
    waitingOn: row.waiting_handle,
    ...(row.waiting_deleted ? { waitingOnDeleted: true } : {}),
    ...(row.waiting_failed ? { waitingOnFailed: true } : {}),
  };
}

function withFacts(row: FactsRow): PostWithFacts {
  return {
    post: toPost(row),
    facts: toFacts(row),
    ...(row.wrap_up ? { wrapUp: true } : {}),
    ...(row.run_error ? { runError: row.run_error } : {}),
  };
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
       batch_id, observed, attachment_ids, opening, after_post_id, user_started)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb,
       $16::uuid[], $17, $18, $19)
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
      post.attachmentIds ?? [],
      post.opening ?? false,
      post.afterPostId ?? null,
      post.userStarted ?? false,
    ],
  );
  if (rows[0]) return toPost(rows[0]);
  const existing = await existingPost(db, post);
  if (!existing) throw new Error(`Outpost post ${post.id} was neither inserted nor found.`);
  return existing;
}

export async function attachmentsFree(
  db: Queryable,
  workspaceId: string,
  attachmentIds: readonly string[],
): Promise<boolean> {
  if (attachmentIds.length === 0) return true;
  const { rows } = await db.query<{ free: number }>(
    `SELECT count(*)::int AS free FROM attachments a
     WHERE a.id = ANY($2::uuid[]) AND a.workspace_id = $1 AND a.message_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM outpost_posts p WHERE a.id = ANY(p.attachment_ids))`,
    [workspaceId, attachmentIds],
  );
  return rows[0]?.free === attachmentIds.length;
}

export async function postAttachmentIds(db: Queryable, postId: string): Promise<string[]> {
  const { rows } = await db.query<{ attachment_ids: string[] }>(
    'SELECT attachment_ids FROM outpost_posts WHERE id = $1',
    [postId],
  );
  return rows[0]?.attachment_ids ?? [];
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

export async function postsById(
  db: Queryable,
  postIds: readonly string[],
): Promise<Map<string, PostWithFacts>> {
  if (postIds.length === 0) return new Map();
  const { rows } = await db.query<FactsRow>(`${FACTS_QUERY} WHERE p.id = ANY($1::uuid[])`, [
    postIds,
  ]);
  return new Map(rows.map((row) => [row.id, withFacts(row)]));
}

export const closePost: PostStore['closePost'] = async (db, postId, closed) => {
  const { rowCount } = await db.query(
    `UPDATE outpost_posts SET closed_state = $2, closed_reason = $3, closed_at = now()
     WHERE id = $1 AND kind = 'request' AND closed_state IS NULL`,
    [postId, closed.state, closed.reason],
  );
  return rowCount === 1;
};

export async function markAnswersSeen(
  db: Queryable,
  postIds: readonly string[],
): Promise<string[]> {
  if (postIds.length === 0) return [];
  const { rows } = await db.query<{ id: string }>(
    `UPDATE outpost_posts SET answer_seen_at = now()
     WHERE id = ANY($1::uuid[]) AND kind = 'request' AND answer_seen_at IS NULL
     RETURNING id`,
    [postIds],
  );
  const claimed = new Set(rows.map((row) => row.id));
  return [...new Set(postIds)].filter((id) => claimed.has(id));
}

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
       AND p.after_post_id IS NULL
     ORDER BY p.created_at, p.id`,
  );
  return rows.map(toPost);
};

export const heldRequests: PostStore['heldRequests'] = async (db) => {
  const { rows } = await db.query<PostRow>(
    `SELECT p.* FROM outpost_posts p JOIN outposts o ON o.id = p.outpost_id
     WHERE p.kind = 'request' AND p.task_id IS NULL AND p.closed_state IS NULL
       AND p.to_conversation_id IS NOT NULL AND o.paused_at IS NULL
       AND p.after_post_id IS NOT NULL
     ORDER BY p.created_at, p.id`,
  );
  const after = await postsById(
    db,
    rows.flatMap((row) => row.after_post_id ?? []),
  );
  const held: HeldRequest[] = [];
  for (const row of rows) {
    const waitsFor = row.after_post_id === null ? undefined : after.get(row.after_post_id);
    if (waitsFor) held.push({ post: toPost(row), after: waitsFor });
  }
  return held;
};

export const releaseHold: PostStore['releaseHold'] = async (db, postId) => {
  const { rowCount } = await db.query(
    `UPDATE outpost_posts SET after_post_id = NULL
     WHERE id = $1 AND kind = 'request' AND task_id IS NULL AND closed_state IS NULL
       AND after_post_id IS NOT NULL`,
    [postId],
  );
  return rowCount === 1;
};
