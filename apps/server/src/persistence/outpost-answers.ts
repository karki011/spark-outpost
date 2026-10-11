import {
  PUBLISH_NOTE_ACTIVITY,
  type AnswerPublish,
  type OutpostAnswer,
} from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import type { PostWithFacts } from '../outposts/ports.ts';
import { taskChanges } from '../projects/task-changes.ts';
import { branchWork } from '../workflow/publish-step-work.ts';
import type { Queryable } from './db.ts';
import { workReply } from './work-reply.ts';

interface AnswerRow {
  task_id: string | null;
  conversation_id: string;
  reply: string | null;
  branch: string | null;
  worktree_path: string | null;
  base_commit: string | null;
  owns_branch: boolean | null;
  publish_reason: string | null;
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

async function branchState(row: AnswerRow): Promise<Pick<AnswerPublish, 'committed' | 'pushed'>> {
  const unknown = { committed: null, pushed: null };
  if (!row.worktree_path || !row.branch || !row.base_commit || !row.owns_branch) return unknown;
  try {
    const work = await branchWork(row.worktree_path, row.branch, row.base_commit);
    return { committed: work.commits && !work.uncommitted, pushed: work.commits && work.pushed };
  } catch {
    return unknown;
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
       w.branch, w.path AS worktree_path, w.base_commit, w.owns_branch,
       (SELECT e.payload->'content'->>'reason' FROM run_events e
        WHERE e.run_id = r.id AND e.type = 'ACTIVITY_SNAPSHOT'
          AND e.payload->>'activityType' = '${PUBLISH_NOTE_ACTIVITY}'
        ORDER BY e.seq DESC LIMIT 1) AS publish_reason,
       ARRAY(SELECT id::text FROM family) AS run_ids,
       ARRAY(
         SELECT l.url FROM task_links l
         WHERE l.task_id = r.task_id AND l.kind = 'pr' AND l.created_at >= r.created_at
         ORDER BY l.created_at, l.id
       ) AS pull_requests
     FROM runs r
     LEFT JOIN LATERAL (
       SELECT branch, path, base_commit, owns_branch FROM chat_worktrees
       WHERE conversation_id = r.conversation_id AND removed_at IS NULL
       ORDER BY created_at LIMIT 1
     ) w ON true
     WHERE r.id = $1`,
    [post.runId],
  );
  const row = rows[0];
  if (!row) return null;
  const changes = await changedPaths(db, workspaceId, row.task_id, row.run_ids);
  const reason = row.pull_requests.length > 0 ? null : row.publish_reason;
  return {
    text: answerText(row.reply, options.maxChars),
    branch: row.branch,
    changes,
    pullRequests: row.pull_requests,
    publish: changes.length > 0 || reason !== null ? { ...(await branchState(row)), reason } : null,
  };
}
