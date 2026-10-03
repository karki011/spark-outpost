import { z } from 'zod';
import type { FeedbackState, SparkAction } from '@spark-outpost/contracts';
import {
  feedbackFor,
  getWatch,
  pollNow,
  updateFeedback,
  type StoredFeedback,
  type Watch,
} from '../../persistence/pr-watches.ts';
import type { Queryable } from '../../persistence/db.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { pullNumberInput, watchesFor } from '../tools/pr-follow-up-tool.ts';
import { proposeAction } from './confirm.ts';
import type { Performed } from './performed.ts';
import { ACTION_NOTE } from './action-note.ts';

const REOPENABLE: readonly FeedbackState[] = ['queued', 'held', 'needs_user', 'skipped'];

function pickItems(items: readonly StoredFeedback[], labels: readonly string[] | undefined) {
  if (!labels || labels.length === 0) return items.filter((item) => item.state !== 'held');
  const wanted = new Set(labels.map((label) => label.toUpperCase()));
  const picked = items.filter((item) => wanted.has(item.label));
  const missing = [...wanted].filter((label) => !picked.some((item) => item.label === label));
  if (missing.length > 0) {
    throw new SparkToolError(`No open item ${missing.join(', ')} on this PR.`);
  }
  return picked;
}

async function requestRound(db: Queryable, watch: Watch, items: readonly StoredFeedback[]) {
  await updateFeedback(
    db,
    items.map((item) => item.id),
    { state: 'queued' },
  );
  await db.query(
    "UPDATE pr_watches SET requested = true, phase = 'watching', updated_at = now() WHERE id = $1",
    [watch.id],
  );
  await pollNow(db, watch.id);
}

async function askForRound(
  context: SparkToolContext,
  args: { number?: number | undefined; items?: string[] | undefined },
) {
  const watches = await watchesFor(context, args.number);
  const watch = watches.find((entry) => entry.phase !== 'done');
  if (!watch) throw new SparkToolError('That pull request is merged or closed.');
  if (watch.phase === 'fixing' || watch.phase === 'confirming') {
    throw new SparkToolError('A follow-up round is already running or waiting for the user.');
  }
  const open = await feedbackFor(context.deps.db, watch.id, REOPENABLE);
  const items = pickItems(open, args.items);
  if (items.length === 0) throw new SparkToolError('Nothing on this PR is waiting for a round.');
  const action: SparkAction = {
    action: 'pr_follow_up_round',
    watchId: watch.id,
    repo: `${watch.owner}/${watch.repo}`,
    number: watch.number,
    items: items.map((item) => ({
      label: item.label,
      author: item.author,
      what: item.body.split('\n')[0]!.slice(0, 200),
    })),
  };
  return proposeAction(context, action);
}

export async function performFollowUpRound(
  context: SparkToolContext,
  action: Extract<SparkAction, { action: 'pr_follow_up_round' }>,
): Promise<Performed> {
  const { db } = context.deps;
  const watch = await getWatch(db, action.watchId);
  if (!watch || watch.phase === 'done') throw new Error('That pull request is merged or closed.');
  if (watch.phase === 'fixing' || watch.phase === 'confirming') {
    throw new Error('A follow-up round is already running or waiting for the user.');
  }
  const open = await feedbackFor(db, watch.id, REOPENABLE);
  const items = pickItems(
    open,
    action.items.map((item) => item.label),
  );
  if (items.length === 0) throw new Error('Nothing on this PR is waiting for a round.');
  await requestRound(db, watch, items);
  return {
    message:
      'Spark starts the round on its next check. The push and replies still follow the chat’s autonomy level.',
    url: watch.url,
    output: { queued: items.map((item) => item.label) },
  };
}

export const prFollowUpRoundTool = sparkTool({
  name: 'spark_pr_follow_up_round',
  title: 'Request a PR follow-up round',
  acts: true,
  description:
    "Ask Spark to run one more follow-up round on a pull request it opened (default: this chat's): a Builder fixes the chosen items in the chat's worktree, then the push and GitHub replies follow the chat's autonomy level. Pass item labels (F1, F2, …) from spark_pr_follow_up to include items Spark held back, such as comments from people without write access, or items past the round limit; with no labels it takes every open item except held ones. " +
    ACTION_NOTE,
  input: {
    number: pullNumberInput,
    items: z
      .array(
        z
          .string()
          .trim()
          .regex(/^F\d+$/i),
      )
      .max(100)
      .optional()
      .describe('Item labels to include, e.g. ["F2", "F5"].'),
  },
  run: (args, context) => askForRound(context, args),
});
