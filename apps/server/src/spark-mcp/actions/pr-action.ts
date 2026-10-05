import { z } from 'zod';
import {
  SPARK_TEXT_MAX,
  SPARK_TITLE_MAX,
  type ShipResult,
  type SparkAction,
} from '@spark-outpost/contracts';
import type { Queryable } from '../../persistence/db.ts';
import { DEFAULT_BRANCH_PREFIX } from '../../projects/worktrees.ts';
import type { ShipDeps } from '../../ship/prepare.ts';
import { shipPreview, shipTask } from '../../ship/service.ts';
import { gitHubDepsFor } from '../deps.ts';
import { sparkTool, SparkToolError, uuidInput, type SparkToolContext } from '../tool.ts';
import { proposeAction } from './confirm.ts';
import type { Performed } from './performed.ts';
import { ACTION_NOTE } from './action-note.ts';

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

function shipDepsOf(context: SparkToolContext): ShipDeps {
  return {
    ...gitHubDepsFor(context.deps, context.scope),
    branchPrefix: context.deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
  };
}

function shippedMessage(result: ShipResult): string {
  const pull = result.pullRequest;
  if (!pull && result.prLink) return `Pushed ${result.branch}. ${result.prLink.label}.`;
  if (!pull) return `Pushed ${result.branch} without a pull request.`;
  const verb = pull.created ? 'Opened' : 'Updated';
  return `${verb} ${pull.draft ? 'draft PR' : 'PR'} #${pull.number}.`;
}

export async function performOpenPr(
  context: SparkToolContext,
  action: Extract<SparkAction, { action: 'open_pr' }>,
): Promise<Performed> {
  const body = action.body.trim();
  const result = await shipTask(
    shipDepsOf(context),
    action.taskId,
    { mode: 'draft_pr', title: action.title },
    { ...DURING_RUN, notes: body ? [body] : [] },
  );
  return {
    message: shippedMessage(result),
    url: result.pullRequest?.url ?? result.prLink?.url ?? null,
    output: {
      number: result.pullRequest?.number ?? null,
      branch: result.branch,
      commit: result.commit,
      files: result.committedFiles.length,
    },
  };
}

async function openPr(
  context: SparkToolContext,
  args: { title: string; body: string; task?: string | undefined },
) {
  const { deps, scope } = context;
  const ship = shipDepsOf(context);
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
  return proposeAction(context, action);
}

export const pullRequestActionTool = sparkTool({
  name: 'spark_open_pr',
  title: 'Open a PR',
  acts: true,
  needs: 'pull_requests',
  description:
    "Open a pull request for this chat's changes through Spark's Ship flow: commit, push the task's own branch, open a PR (ready for review or draft per Settings → Spark → Open pull requests as). Nothing merges, never force-pushes, never pushes the default branch. You propose the title and description. When the user asks for a PR, use this tool, not git push or gh. Returns the PR URL and number. " +
    ACTION_NOTE,
  input: {
    title: z.string().trim().min(1).max(SPARK_TITLE_MAX),
    body: z.string().max(SPARK_TEXT_MAX).default('').describe('What changed and why.'),
    task: uuidInput.optional().describe("Task id; defaults to the chat's latest task."),
  },
  run: (args, context) => openPr(context, args),
});
