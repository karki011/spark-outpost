import { z } from 'zod';
import { SPARK_TEXT_MAX, SPARK_TITLE_MAX, type SparkAction } from '@spark-outpost/contracts';
import type { Queryable } from '../../persistence/db.ts';
import { DEFAULT_BRANCH_PREFIX } from '../../projects/worktrees.ts';
import type { ShipDeps } from '../../ship/prepare.ts';
import { shipPreview, shipTask } from '../../ship/service.ts';
import { gitHubDepsFor } from '../deps.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { confirmThen } from './confirm.ts';

const FILES_SHOWN = 50;
const DURING_RUN = { duringRun: true };

async function taskFor(
  db: Queryable,
  conversationId: string | null,
  requested: string | undefined,
): Promise<string> {
  if (!conversationId) throw new SparkToolError('This session has no chat to ship from.');
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM tasks WHERE conversation_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [conversationId, requested ?? null],
  );
  if (!rows[0]) {
    throw new SparkToolError(
      requested ? 'That task is not in this chat.' : 'This chat has no changes to ship yet.',
    );
  }
  return rows[0].id;
}

async function openPr(
  context: SparkToolContext,
  args: { title: string; body: string; task?: string | undefined },
) {
  const { deps, scope } = context;
  const ship: ShipDeps = {
    ...gitHubDepsFor(deps, scope),
    branchPrefix: deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
  };
  const taskId = await taskFor(deps.db, scope.conversationId, args.task);
  const preview = await shipPreview(ship, taskId, DURING_RUN);
  if (preview.blocked) throw new SparkToolError(preview.blocked.message);
  if (!preview.modes.includes('draft_pr')) {
    throw new SparkToolError(
      preview.notes[0] ?? 'Spark cannot open a pull request for these changes.',
    );
  }
  const action: SparkAction = {
    action: 'open_pr',
    taskId,
    title: args.title,
    body: args.body,
    branch: preview.branch,
    base: preview.baseBranch,
    repo: preview.remote?.repo ?? null,
    files: preview.files.slice(0, FILES_SHOWN),
    moreFiles: Math.max(0, preview.files.length - FILES_SHOWN),
  };
  return confirmThen(context, action, async (confirmed) => {
    if (confirmed.action !== 'open_pr') throw new Error('Unexpected action.');
    const result = await shipTask(
      ship,
      taskId,
      { mode: 'draft_pr', title: confirmed.title },
      { ...DURING_RUN, notes: confirmed.body.trim() ? [confirmed.body.trim()] : [] },
    );
    return {
      url: result.pullRequest?.url ?? null,
      number: result.pullRequest?.number ?? null,
      branch: result.branch,
      commit: result.commit,
      files: result.committedFiles.length,
    };
  });
}

export const pullRequestActionTool = sparkTool({
  name: 'spark_open_pr',
  title: 'Open a draft PR',
  acts: true,
  description:
    "Open a draft pull request for this chat's changes through Spark's Ship flow (commit, push the task's own branch, open a draft PR; nothing merges). You propose the title and description; Spark shows the user a card with the branch, base and files, they may edit the text, and nothing happens until they confirm. The call waits and returns the PR URL and number, or that the user declined.",
  input: {
    title: z.string().trim().min(1).max(SPARK_TITLE_MAX),
    body: z.string().max(SPARK_TEXT_MAX).default('').describe('What changed and why.'),
    task: z.uuid().optional().describe("Task id; defaults to the chat's latest task."),
  },
  run: (args, context) => openPr(context, args),
});
