import {
  isTerminalRunStatus,
  needsYouLines,
  QUEUE_LIMIT,
  SPARK_TEXT_MAX,
  type AppEvent,
  type RejectReason,
  type RunStatus,
} from '@spark-outpost/contracts';
import { redactText, storableText } from '../audit/redact.ts';
import { alreadySent } from './chat-queue.ts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { newId } from './ids.ts';
import { requestCancel } from './runs.ts';

export interface ChatFacts {
  conversationId: string;
  title: string;
  handle: string | null;
  outpostName: string | null;
  projects: string[];
}

export interface InboundRequest {
  messageId: string;
  contextId: string | null;
  text: string;
}

export type AcceptRefusal =
  | 'no_chat'
  | 'no_outpost'
  | 'other_outpost'
  | 'other_chat'
  | 'id_taken'
  | 'empty'
  | 'too_long';

export type AcceptOutcome =
  | { kind: 'accepted'; postId: string; taskId: string; queued: boolean }
  | { kind: 'rejected'; postId: string; taskId: string; reason: RejectReason }
  | { kind: 'refused'; why: AcceptRefusal };

export interface TaskPost {
  postId: string;
  outpostId: string;
  conversationId: string | null;
}

export type CancelOutcome =
  | { kind: 'not_found' }
  | { kind: 'finished' }
  | { kind: 'cancelled' }
  | { kind: 'stopping'; runId: string };

interface PostRow {
  id: string;
  outpost_id: string;
  kind: string;
  body: string;
  to_conversation_id: string | null;
  guest: boolean;
  task_id: string | null;
  run_id: string | null;
  closed_state: string | null;
}

interface DeliveryFacts {
  archived: boolean;
  mayReceive: boolean;
  queued: number;
}

const POST_COLUMNS =
  'id, outpost_id, kind, body, to_conversation_id, guest, task_id, run_id, closed_state';

export function deliveryProblem(facts: DeliveryFacts): RejectReason | null {
  if (!facts.mayReceive) return 'not_member';
  if (facts.archived) return 'chat_archived';
  if (facts.queued >= QUEUE_LIMIT) return 'queue_full';
  return null;
}

export async function chatFacts(db: Queryable, chatId: string): Promise<ChatFacts | null> {
  const { rows } = await db.query<{
    title: string;
    handle: string | null;
    outpost_name: string | null;
    projects: string[];
  }>(
    `SELECT c.title, m.handle, o.name AS outpost_name,
       ARRAY(
         SELECT p.name FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
         WHERE cp.conversation_id = c.id ORDER BY cp.position
       ) AS projects
     FROM conversations c
     LEFT JOIN outpost_members m ON m.conversation_id = c.id
     LEFT JOIN outposts o ON o.id = m.outpost_id
     WHERE c.id = $1 AND c.session_type <> 'terminal'`,
    [chatId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    conversationId: chatId,
    title: row.title,
    handle: row.handle,
    outpostName: row.outpost_name,
    projects: row.projects,
  };
}

async function notifyOutpost(db: Queryable, outpostId: string, chatId: string | null) {
  const event: AppEvent = {
    kind: 'outpost_changed',
    conversationId: chatId,
    runId: null,
    outpostId,
  };
  await db.query(`SELECT pg_notify('changes', $1)`, [JSON.stringify(event)]);
}

async function lockChat(db: Queryable, chatId: string): Promise<{ archived: boolean } | null> {
  const { rows } = await db.query<{ archived: boolean }>(
    `SELECT archived_at IS NOT NULL AS archived FROM conversations
     WHERE id = $1 AND session_type <> 'terminal' FOR UPDATE`,
    [chatId],
  );
  return rows[0] ?? null;
}

async function lockPost(db: Queryable, postId: string): Promise<PostRow | null> {
  const { rows } = await db.query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM outpost_posts WHERE id = $1 FOR UPDATE`,
    [postId],
  );
  return rows[0] ?? null;
}

async function idTaken(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ taken: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM messages WHERE id = $1)
       OR EXISTS (SELECT 1 FROM chat_queue WHERE id = $1) AS taken`,
    [id],
  );
  return rows[0]?.taken ?? false;
}

async function postFromAnotherChat(
  db: Queryable,
  chatId: string,
  request: InboundRequest,
): Promise<PostRow | AcceptRefusal> {
  const member = await db.query<{ outpost_id: string; handle: string }>(
    'SELECT outpost_id, handle FROM outpost_members WHERE conversation_id = $1',
    [chatId],
  );
  const membership = member.rows[0];
  if (!membership) return 'no_outpost';
  if (request.contextId !== null && request.contextId !== membership.outpost_id) {
    return 'other_outpost';
  }
  const body = redactText(storableText(request.text)).trim();
  if (body === '') return 'empty';
  if (body.length > SPARK_TEXT_MAX) return 'too_long';
  if (await idTaken(db, request.messageId)) return 'id_taken';
  const { rows } = await db.query<PostRow>(
    `INSERT INTO outpost_posts (id, outpost_id, kind, body, from_user, to_handle, to_conversation_id)
     VALUES ($1, $2, 'request', $3, false, $4, $5)
     RETURNING ${POST_COLUMNS}`,
    [request.messageId, membership.outpost_id, body, membership.handle, chatId],
  );
  return rows[0]!;
}

function storedPostProblem(
  post: PostRow,
  chatId: string,
  request: InboundRequest,
): AcceptRefusal | null {
  if (post.kind !== 'request' || post.to_conversation_id !== chatId) return 'other_chat';
  if (request.contextId !== null && request.contextId !== post.outpost_id) return 'other_outpost';
  return null;
}

async function mayReceive(db: Queryable, post: PostRow, chatId: string): Promise<boolean> {
  if (post.guest) return true;
  const { rowCount } = await db.query(
    'SELECT 1 FROM outpost_members WHERE outpost_id = $1 AND conversation_id = $2',
    [post.outpost_id, chatId],
  );
  return rowCount === 1;
}

async function queuedCount(db: Queryable, chatId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM chat_queue WHERE conversation_id = $1',
    [chatId],
  );
  return rows[0]?.count ?? 0;
}

async function queuePost(db: Queryable, post: PostRow, chatId: string): Promise<void> {
  if (await alreadySent(db, post.id)) return;
  await db.query(
    `INSERT INTO chat_queue (id, conversation_id, position, content, outpost_post_id)
     SELECT $1, $2, COALESCE(MAX(position), 0) + 1, $3, $1
     FROM chat_queue WHERE conversation_id = $2
     ON CONFLICT (id) DO NOTHING`,
    [post.id, chatId, post.body],
  );
}

async function deliver(
  db: Queryable,
  post: PostRow,
  chatId: string,
  archived: boolean,
): Promise<AcceptOutcome> {
  const taskId = newId();
  if (post.closed_state !== null) {
    await db.query('UPDATE outpost_posts SET task_id = $2 WHERE id = $1', [post.id, taskId]);
    return { kind: 'accepted', postId: post.id, taskId, queued: false };
  }
  const reason = deliveryProblem({
    archived,
    mayReceive: await mayReceive(db, post, chatId),
    queued: await queuedCount(db, chatId),
  });
  if (reason !== null) {
    await db.query(
      `UPDATE outpost_posts
       SET task_id = $2, closed_state = 'rejected', closed_reason = $3, closed_at = now()
       WHERE id = $1`,
      [post.id, taskId, reason],
    );
    return { kind: 'rejected', postId: post.id, taskId, reason };
  }
  await db.query('UPDATE outpost_posts SET task_id = $2 WHERE id = $1', [post.id, taskId]);
  await queuePost(db, post, chatId);
  return { kind: 'accepted', postId: post.id, taskId, queued: true };
}

export function acceptTask(db: Db, chatId: string, request: InboundRequest): Promise<AcceptOutcome> {
  return withTransaction(db, async (client) => {
    const chat = await lockChat(client, chatId);
    if (!chat) return { kind: 'refused', why: 'no_chat' };
    const stored = await lockPost(client, request.messageId);
    const post = stored ?? (await postFromAnotherChat(client, chatId, request));
    if (typeof post === 'string') return { kind: 'refused', why: post };
    const problem = storedPostProblem(post, chatId, request);
    if (problem !== null) return { kind: 'refused', why: problem };
    if (post.task_id !== null) {
      return { kind: 'accepted', postId: post.id, taskId: post.task_id, queued: false };
    }
    const outcome = await deliver(client, post, chatId, chat.archived);
    await notifyOutpost(client, post.outpost_id, chatId);
    return outcome;
  });
}

export async function taskPost(db: Queryable, taskId: string): Promise<TaskPost | null> {
  const { rows } = await db.query<{
    id: string;
    outpost_id: string;
    to_conversation_id: string | null;
  }>('SELECT id, outpost_id, to_conversation_id FROM outpost_posts WHERE task_id = $1', [taskId]);
  const row = rows[0];
  if (!row) return null;
  return { postId: row.id, outpostId: row.outpost_id, conversationId: row.to_conversation_id };
}

async function closeCancelled(db: Queryable, postId: string): Promise<CancelOutcome> {
  await db.query(
    `UPDATE outpost_posts SET closed_state = 'cancelled', closed_at = now() WHERE id = $1`,
    [postId],
  );
  return { kind: 'cancelled' };
}

async function asksTheUser(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ content: string }>(
    `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'
     ORDER BY created_at DESC LIMIT 1`,
    [runId],
  );
  return rows[0] !== undefined && needsYouLines(rows[0].content).length > 0;
}

async function cancelCarried(db: Queryable, post: PostRow): Promise<CancelOutcome> {
  if (post.run_id === null) return closeCancelled(db, post.id);
  const { rows } = await db.query<{ status: RunStatus }>('SELECT status FROM runs WHERE id = $1', [
    post.run_id,
  ]);
  const status = rows[0]?.status;
  if (status === undefined) return closeCancelled(db, post.id);
  if (!isTerminalRunStatus(status)) {
    await requestCancel(db, post.run_id);
    return { kind: 'stopping', runId: post.run_id };
  }
  if (status === 'succeeded' && (await asksTheUser(db, post.run_id))) {
    return closeCancelled(db, post.id);
  }
  return { kind: 'finished' };
}

export function cancelPost(db: Db, postId: string): Promise<CancelOutcome> {
  return withTransaction(db, async (client) => {
    const addressed = await client.query<{ to_conversation_id: string | null }>(
      `SELECT to_conversation_id FROM outpost_posts WHERE id = $1 AND kind = 'request'`,
      [postId],
    );
    const chatId = addressed.rows[0]?.to_conversation_id ?? null;
    if (chatId !== null) await lockChat(client, chatId);
    const post = await lockPost(client, postId);
    if (!post || post.kind !== 'request') return { kind: 'not_found' };
    if (post.closed_state !== null) return { kind: 'finished' };
    const unqueued = await client.query('DELETE FROM chat_queue WHERE outpost_post_id = $1', [
      post.id,
    ]);
    const outcome =
      unqueued.rowCount === 1
        ? await closeCancelled(client, post.id)
        : await cancelCarried(client, post);
    await notifyOutpost(client, post.outpost_id, post.to_conversation_id);
    return outcome;
  });
}

export async function cancelTask(db: Db, taskId: string): Promise<CancelOutcome> {
  const task = await taskPost(db, taskId);
  if (!task) return { kind: 'not_found' };
  return cancelPost(db, task.postId);
}
