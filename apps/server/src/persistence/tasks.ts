import {
  TASK_TITLE_MAX_LENGTH,
  clipAtWord,
  UNTITLED_CONVERSATION,
  type TaskLink,
  type TaskLinkSource,
} from '@spark-outpost/contracts';
import { chooseTask, type TaskRef } from '../tasks/rules.ts';
import { linkTaskToChatTickets } from './chat-tickets.ts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { newId } from './ids.ts';

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Task ${id} was not found.`);
  }
}

export interface RunTask {
  taskId: string;
  planVersion: number | null;
}

interface LinkRow {
  id: string;
  kind: TaskLink['kind'];
  url: string;
  title: string | null;
  source: TaskLinkSource;
  created_at: Date;
}

export function taskTitle(request: string): string {
  const line = request.trim().split('\n')[0] ?? '';
  return clipAtWord(line, TASK_TITLE_MAX_LENGTH) || UNTITLED_CONVERSATION;
}

async function latestTask(db: Queryable, conversationId: string): Promise<TaskRef | null> {
  const { rows } = await db.query<TaskRef>(
    `SELECT id, status FROM tasks WHERE conversation_id = $1
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

export async function chatTaskIds(db: Queryable, conversationId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM tasks WHERE conversation_id = $1 ORDER BY created_at, id',
    [conversationId],
  );
  return rows.map((row) => row.id);
}

async function currentPlanVersion(db: Queryable, taskId: string): Promise<number | null> {
  const { rows } = await db.query<{ version: number | null }>(
    `SELECT MAX(version) AS version FROM run_artifacts WHERE task_id = $1 AND kind = 'plan'`,
    [taskId],
  );
  return rows[0]?.version ?? null;
}

export async function taskForNewRun(
  db: Queryable,
  conversationId: string,
): Promise<RunTask | null> {
  const choice = chooseTask(await latestTask(db, conversationId), false);
  if (choice.kind !== 'join') return null;
  return { taskId: choice.taskId, planVersion: await currentPlanVersion(db, choice.taskId) };
}

export async function runTask(db: Queryable, runId: string): Promise<RunTask | null> {
  const { rows } = await db.query<{ task_id: string | null; plan_version: number | null }>(
    'SELECT task_id, plan_version FROM runs WHERE id = $1',
    [runId],
  );
  const row = rows[0];
  return row?.task_id ? { taskId: row.task_id, planVersion: row.plan_version } : null;
}

async function lockRunConversation(
  db: Queryable,
  runId: string,
): Promise<{ conversation_id: string; task_id: string | null }> {
  const { rows } = await db.query<{ conversation_id: string; task_id: string | null }>(
    `SELECT r.conversation_id, r.task_id FROM runs r
     JOIN conversations c ON c.id = r.conversation_id
     WHERE r.id = $1 FOR UPDATE OF c`,
    [runId],
  );
  const run = rows[0];
  if (!run) throw new Error(`Run ${runId} was not found.`);
  return run;
}

async function insertTask(
  db: Queryable,
  taskId: string,
  conversationId: string,
  request: string,
): Promise<void> {
  await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
    taskId,
    conversationId,
    taskTitle(request),
  ]);
  await linkTaskToChatTickets(db, taskId, conversationId);
}

export async function taskForWorkingRun(
  db: Db,
  runId: string,
  request: string,
): Promise<{ task: RunTask; opened: boolean }> {
  return withTransaction(db, async (client) => {
    const run = await lockRunConversation(client, runId);
    if (run.task_id) {
      return {
        task: { taskId: run.task_id, planVersion: await currentPlanVersion(client, run.task_id) },
        opened: false,
      };
    }
    const choice = chooseTask(await latestTask(client, run.conversation_id), true);
    const taskId = choice.kind === 'join' ? choice.taskId : newId();
    if (choice.kind === 'open') {
      await insertTask(client, taskId, run.conversation_id, request);
    }
    const planVersion = await currentPlanVersion(client, taskId);
    await client.query('UPDATE runs SET task_id = $2, plan_version = $3 WHERE id = $1', [
      runId,
      taskId,
      planVersion,
    ]);
    return { task: { taskId, planVersion }, opened: choice.kind === 'open' };
  });
}

export interface TaskContext {
  taskId: string;
  previousRequest: string;
  summary: string;
  lastReplyAt: Date | null;
}

export async function currentTaskContext(
  db: Queryable,
  runId: string,
): Promise<TaskContext | null> {
  const { rows } = await db.query<{
    task_id: string;
    request: string;
    reply: string | null;
    replied_at: Date | null;
  }>(
    `SELECT p.task_id, m.content AS request, a.content AS reply, a.created_at AS replied_at
     FROM runs me
     JOIN runs p ON p.task_id = me.task_id AND p.parent_run_id IS NULL AND p.id <> me.id
       AND p.created_at < me.created_at
     JOIN messages m ON m.id = p.user_message_id
     LEFT JOIN messages a ON a.run_id = p.id AND a.role = 'assistant'
     WHERE me.id = $1 AND me.task_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM runs c WHERE c.parent_run_id = p.id AND c.role = 'builder')
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [runId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    taskId: row.task_id,
    previousRequest: row.request,
    summary: row.reply ?? '',
    lastReplyAt: row.replied_at,
  };
}

export async function startNewTask(
  db: Db,
  runId: string,
  request: string,
): Promise<{ taskId: string; closed: string | null }> {
  return withTransaction(db, async (client) => {
    const run = await lockRunConversation(client, runId);
    if (run.task_id) {
      await client.query(
        `UPDATE tasks SET status = 'closed', closed_at = now()
         WHERE id = $1 AND status = 'open'`,
        [run.task_id],
      );
    }
    const taskId = newId();
    await insertTask(client, taskId, run.conversation_id, request);
    await client.query('UPDATE runs SET task_id = $2, plan_version = NULL WHERE id = $1', [
      runId,
      taskId,
    ]);
    return { taskId, closed: run.task_id };
  });
}

function toTaskLink(row: LinkRow): TaskLink {
  return {
    id: row.id,
    kind: row.kind,
    url: row.url,
    title: row.title,
    source: row.source,
    createdAt: row.created_at.toISOString(),
  };
}

export interface NewTaskLink {
  kind: TaskLink['kind'];
  url: string;
  title: string | null;
  source: TaskLinkSource;
}

export async function addTaskLink(
  db: Queryable,
  taskId: string,
  link: NewTaskLink,
): Promise<{ link: TaskLink; created: boolean }> {
  const inserted = await db.query<LinkRow>(
    `INSERT INTO task_links (id, task_id, kind, url, title, source)
     SELECT $1, id, $3, $4, $5, $6 FROM tasks WHERE id = $2
     ON CONFLICT (task_id, url) DO NOTHING RETURNING *`,
    [newId(), taskId, link.kind, link.url, link.title, link.source],
  );
  if (inserted.rows[0]) return { link: toTaskLink(inserted.rows[0]), created: true };
  const existing = await db.query<LinkRow>(
    'SELECT * FROM task_links WHERE task_id = $1 AND url = $2',
    [taskId, link.url],
  );
  if (!existing.rows[0]) throw new TaskNotFoundError(taskId);
  return { link: toTaskLink(existing.rows[0]), created: false };
}

export async function taskLinks(db: Queryable, taskIds: readonly string[]) {
  const { rows } = await db.query<LinkRow & { task_id: string }>(
    'SELECT * FROM task_links WHERE task_id = ANY($1::uuid[]) ORDER BY created_at, id',
    [taskIds],
  );
  const byTask = new Map<string, TaskLink[]>();
  for (const row of rows) {
    const links = byTask.get(row.task_id) ?? [];
    links.push(toTaskLink(row));
    byTask.set(row.task_id, links);
  }
  return byTask;
}
