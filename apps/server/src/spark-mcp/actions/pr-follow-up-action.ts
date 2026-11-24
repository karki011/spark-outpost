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
import { newId } from '../../persistence/ids.ts';
import { insertMemberMessage } from '../../persistence/member-messages.ts';
import { MAIN_AGENT_NOTE } from '../../pr-follow-up/prompt.ts';
import { stopRun } from '../../workflow/stop-run.ts';
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

async function runningRound(context: SparkToolContext, number: number | undefined) {
  const { conversationId, runId } = context.scope;
  const watches = await watchesFor(context, number);
  const watch = watches.find(
    (entry) =>
      entry.phase === 'fixing' && entry.roundRunId && entry.conversationId === conversationId,
  );
  if (!watch?.roundRunId) {
    throw new SparkToolError('No follow-up round is running on this chat\u2019s pull request.');
  }
  if (watch.roundRunId === runId) {
    throw new SparkToolError(
      'This is the follow-up round itself; only the chat\u2019s agent uses this.',
    );
  }
  return { watch, roundRunId: watch.roundRunId };
}

async function stopRound(context: SparkToolContext, number: number | undefined) {
  const { watch, roundRunId } = await runningRound(context, number);
  await stopRun(context.deps.db, roundRunId);
  return {
    message: `Stopped follow-up round ${watch.rounds} on PR #${watch.number}. Its edits so far stay in the folder and nothing more is pushed; its items wait for you. Ask for another round with this tool when the work here is done.`,
    url: watch.url,
  };
}

async function messageRound(
  context: SparkToolContext,
  args: { number?: number | undefined; message?: string | undefined },
) {
  const body = args.message?.trim();
  if (!body) throw new SparkToolError('Pass the message for the follow-up agent.');
  const { watch, roundRunId } = await runningRound(context, args.number);
  await insertMemberMessage(context.deps.db, {
    id: newId(),
    conversationId: watch.conversationId,
    runId: roundRunId,
    body: `${MAIN_AGENT_NOTE}\n${body}`,
    urgency: 'now',
  });
  return {
    message: `Sent to the follow-up agent on PR #${watch.number}. It reads it while it works; it does not reply here.`,
    url: watch.url,
  };
}

export const prFollowUpRoundTool = sparkTool({
  name: 'spark_pr_follow_up_round',
  title: 'Start, stop or message a PR follow-up round',
  acts: true,
  needs: 'pull_requests',
  description:
    'A follow-up round on a pull request Spark opened (default: this chat\'s) is run by a separate follow-up agent in the chat\'s worktree. action "start" (the default) asks Spark for one more round: pass item labels (F1, F2, …) from spark_pr_follow_up to include items Spark held back; with no labels it takes every open item except held ones; the push and GitHub replies follow the chat\'s autonomy level. action "stop" stops this chat\'s running round at once, before you or the user change the same work; its edits so far stay and nothing more is pushed. action "message" sends the running round\'s agent a note, for example to wait, to leave a file alone or what changed. ' +
    ACTION_NOTE,
  input: {
    number: pullNumberInput,
    action: z
      .enum(['start', 'stop', 'message'])
      .optional()
      .describe('start (default), stop the running round, or message its agent.'),
    message: z.string().trim().min(1).max(4000).optional().describe('For action "message".'),
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
  run: (args, context) => {
    if (args.action === 'stop') return stopRound(context, args.number);
    if (args.action === 'message') return messageRound(context, args);
    return askForRound(context, args);
  },
});
