import type { OutpostAnswer } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import type { PostWithFacts } from '../outposts/ports.ts';
import { taskChanges } from '../projects/task-changes.ts';
import type { Queryable } from './db.ts';
import { workReply } from './work-reply.ts';

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
       (${workReply('r.id')}) AS reply,
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
