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
  run_id: string;
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

type BranchState = Pick<AnswerPublish, 'committed' | 'pushed'>;
type TaskRuns = Awaited<ReturnType<typeof taskChanges>>['runs'];

export interface AnswerCache {
  branches: Map<string, Promise<BranchState>>;
  tasks: Map<string, Promise<TaskRuns | null>>;
}

export function answerCache(): AnswerCache {
  return { branches: new Map(), tasks: new Map() };
}

export interface AnswerOptions {
  maxChars?: number;
  cache?: AnswerCache;
}

function remembered<T>(
  cache: Map<string, Promise<T>> | undefined,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  if (!cache) return load();
  const known = cache.get(key);
  if (known) return known;
  const loading = load();
  cache.set(key, loading);
  return loading;
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
  cache: AnswerCache | undefined,
): Promise<string[]> {
  if (taskId === null) return [];
  const runs = await remembered(cache?.tasks, taskId, () =>
    taskChanges(db, workspaceId, taskId).then(
      (changes) => changes.runs,
      () => null,
    ),
  );
  if (!runs) return [];
  const files = runs
    .filter((run) => !run.revertedAt && runIds.includes(run.runId))
    .flatMap((run) => run.files);
  return [...new Set(files.map((file) => file.path))];
}

async function branchState(row: AnswerRow, cache: AnswerCache | undefined): Promise<BranchState> {
  const unknown = { committed: null, pushed: null };
  const { worktree_path: root, branch, base_commit: base } = row;
  if (!root || !branch || !base || !row.owns_branch) return unknown;
  return remembered(cache?.branches, `${root}\0${branch}\0${base}`, async () => {
    try {
      const work = await branchWork(root, branch, base);
      return { committed: work.commits && !work.uncommitted, pushed: work.commits && work.pushed };
    } catch {
      return unknown;
    }
  });
}

export async function requestAnswers(
  db: Queryable,
  workspaceId: string,
  requests: readonly PostWithFacts[],
  options: AnswerOptions = {},
): Promise<Map<string, OutpostAnswer | null>> {
  const answers = new Map<string, OutpostAnswer | null>();
  const runOf = new Map<string, string>();
  for (const { post, facts } of requests) {
    answers.set(post.id, null);
    if (post.runId === null || post.closedState !== null || facts?.runStatus !== 'succeeded') {
      continue;
    }
    runOf.set(post.runId, post.id);
  }
  if (runOf.size === 0) return answers;
  const { rows } = await db.query<AnswerRow>(
    `WITH RECURSIVE family AS (
       SELECT id AS root, id FROM runs WHERE id = ANY($1::uuid[])
       UNION ALL
       SELECT family.root, child.id FROM runs child JOIN family ON child.parent_run_id = family.id
     )
     SELECT r.id AS run_id, r.task_id, r.conversation_id,
       (${workReply('r.id')}) AS reply,
       w.branch, w.path AS worktree_path, w.base_commit, w.owns_branch,
       (SELECT e.payload->'content'->>'reason' FROM run_events e
        WHERE e.run_id = r.id AND e.type = 'ACTIVITY_SNAPSHOT'
          AND e.payload->>'activityType' = '${PUBLISH_NOTE_ACTIVITY}'
        ORDER BY e.seq DESC LIMIT 1) AS publish_reason,
       ARRAY(SELECT f.id::text FROM family f WHERE f.root = r.id) AS run_ids,
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
     WHERE r.id = ANY($1::uuid[])`,
    [[...runOf.keys()]],
  );
  await Promise.all(
    rows.map(async (row) => {
      const postId = runOf.get(row.run_id);
      if (postId === undefined) return;
      answers.set(postId, await answerOf(db, workspaceId, row, options));
    }),
  );
  return answers;
}

async function answerOf(
  db: Queryable,
  workspaceId: string,
  row: AnswerRow,
  options: AnswerOptions,
): Promise<OutpostAnswer> {
  const changes = await changedPaths(db, workspaceId, row.task_id, row.run_ids, options.cache);
  const reason = row.pull_requests.length > 0 ? null : row.publish_reason;
  return {
    text: answerText(row.reply, options.maxChars),
    branch: row.branch,
    changes,
    pullRequests: row.pull_requests,
    publish:
      changes.length > 0 || reason !== null
        ? { ...(await branchState(row, options.cache)), reason }
        : null,
  };
}

export async function requestAnswer(
  db: Queryable,
  workspaceId: string,
  request: PostWithFacts,
  options: AnswerOptions = {},
): Promise<OutpostAnswer | null> {
  const answers = await requestAnswers(db, workspaceId, [request], options);
  return answers.get(request.post.id) ?? null;
}
