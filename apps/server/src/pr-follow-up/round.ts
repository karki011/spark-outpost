import {
  PR_PUSH_ITEM,
  SPARK_ACTION_KIND,
  SPARK_ACTION_OPTION,
  applySparkEdits,
  isTerminalRunStatus,
  sparkActionLabels,
  type Approval,
  type PrFollowUpAction,
  type RunStatus,
} from '@spark-outpost/contracts';
import { resolveChatSettings } from '../persistence/chat-settings.ts';
import { insertApproval } from '../persistence/approvals.ts';
import { prFollowUpSettings } from '../persistence/pr-settings.ts';
import {
  feedbackFor,
  updateFeedback,
  WATCHING_LINE,
  type StoredFeedback,
  type Watch,
} from '../persistence/pr-watches.ts';
import { getTaskShip } from '../persistence/task-ships.ts';
import { syncWithPull } from './branch-sync.ts';
import { connectTo, shipDepsOf, startRoundRun, type FollowUpDeps } from './deps.ts';
import { FollowUpBlocked, pendingPush, postReply, pushRound, replyText } from './outward.ts';
import { builderSkipped, itemNotes, roundPrompt } from './prompt.ts';
import { roundLine } from './rounds.ts';

const NEW_COMMIT = 'the new commit';
const CARD_FILES = 30;

const SYNC_LINES = {
  diverged:
    'The PR branch moved on GitHub and can’t fast-forward here. Pull or rebase it yourself, then ask Spark for another round.',
  unreachable:
    'Spark couldn’t read the PR branch from the remote. Check the connection, then ask Spark for another round.',
};

function needsYou(watch: Watch, doing: string): Watch {
  return { ...watch, phase: 'needs_you', doing, roundRunId: null, approvalId: null };
}

export async function startRound(
  deps: FollowUpDeps,
  watch: Watch,
  queued: readonly StoredFeedback[],
): Promise<Watch> {
  const ship = await getTaskShip(deps.db, watch.taskId);
  if (!ship) return needsYou(watch, 'Spark lost track of the branch this PR came from.');
  if (watch.headSha) {
    const sync = await syncWithPull(
      ship.rootPath,
      ship.remote ?? 'origin',
      watch.branch,
      watch.headSha,
    );
    if (sync === 'diverged' || sync === 'unreachable') return needsYou(watch, SYNC_LINES[sync]);
  }
  const round = watch.rounds + 1;
  const content = roundPrompt(
    { repo: `${watch.owner}/${watch.repo}`, number: watch.number, branch: watch.branch, round },
    queued,
  );
  const runId = await startRoundRun(deps, watch, content);
  await updateFeedback(
    deps.db,
    queued.map((item) => item.id),
    { state: 'in_round', round },
  );
  return {
    ...watch,
    phase: 'fixing',
    doing: roundLine(queued.length, round),
    rounds: round,
    roundRunId: runId,
    requested: false,
  };
}

interface RoundRun {
  status: RunStatus;
  taskId: string | null;
  reply: string;
}

async function roundRun(deps: FollowUpDeps, runId: string): Promise<RoundRun | null> {
  const { rows } = await deps.db.query<{
    status: RunStatus;
    task_id: string | null;
    reply: string | null;
  }>(
    `SELECT r.status, r.task_id,
       (SELECT string_agg(m.content, E'\\n' ORDER BY m.created_at) FROM messages m
        WHERE m.run_id = r.id AND m.role = 'assistant') AS reply
     FROM runs r WHERE r.id = $1`,
    [runId],
  );
  const row = rows[0];
  return row ? { status: row.status, taskId: row.task_id, reply: row.reply ?? '' } : null;
}

function where(item: StoredFeedback): string {
  if (item.kind === 'check') return 'failing check';
  if (item.path) return `${item.path}${item.line ? `:${item.line}` : ''}`;
  return item.kind === 'review' ? 'review' : 'comment';
}

function cardItem(item: StoredFeedback, note: string | null, pushes: boolean, replies: boolean) {
  const reply = replies ? replyText(item, note, pushes ? NEW_COMMIT : null) : null;
  return {
    id: item.id,
    label: item.label,
    author: item.author,
    where: where(item),
    what: note ?? item.body.split('\n')[0]!.slice(0, 200),
    reply: item.kind === 'check' ? null : reply,
  };
}

async function askToConfirm(deps: FollowUpDeps, watch: Watch, action: PrFollowUpAction) {
  const labels = sparkActionLabels.pr_follow_up;
  return insertApproval(deps.db, {
    runId: watch.roundRunId!,
    toolCallId: `spark:pr_follow_up:${watch.id}:${watch.rounds}`,
    rpcId: null,
    kind: SPARK_ACTION_KIND,
    title: `${labels.question} ${action.repo}#${action.number}`,
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      sparkAction: action,
    },
    options: [
      { optionId: SPARK_ACTION_OPTION.confirm, name: labels.confirm, kind: 'allow_once' },
      { optionId: SPARK_ACTION_OPTION.decline, name: 'Don’t', kind: 'reject_once' },
    ],
    reason: null,
  });
}

export async function finishRound(deps: FollowUpDeps, watch: Watch): Promise<Watch> {
  const run = watch.roundRunId ? await roundRun(deps, watch.roundRunId) : null;
  if (run && !isTerminalRunStatus(run.status)) return watch;
  const items = await feedbackFor(deps.db, watch.id, ['in_round']);
  const ids = items.map((item) => item.id);
  if (!run || run.status !== 'succeeded') {
    await updateFeedback(deps.db, ids, { state: 'needs_user' });
    const how = run?.status === 'cancelled' ? 'was stopped' : 'did not finish';
    return needsYou(watch, `The fix round ${how}. Ask Spark in the chat to try again.`);
  }
  const notes = itemNotes(run.reply);
  const ship = shipDepsOf(deps, watch.workspaceId);
  const taskId = run.taskId ?? watch.taskId;
  let preview;
  try {
    preview = await pendingPush(ship, watch, taskId);
  } catch (error) {
    if (!(error instanceof FollowUpBlocked)) throw error;
    await updateFeedback(deps.db, ids, { state: 'needs_user' });
    return needsYou(watch, error.message);
  }
  const settings = await prFollowUpSettings(deps.db, watch.workspaceId);
  for (const item of items) {
    await updateFeedback(deps.db, [item.id], {
      state: 'planned',
      reply: notes.get(item.label) ?? null,
    });
  }
  const action: PrFollowUpAction = {
    action: 'pr_follow_up',
    watchId: watch.id,
    repo: `${watch.owner}/${watch.repo}`,
    number: watch.number,
    url: watch.url,
    branch: watch.branch,
    push: preview
      ? {
          files: preview.files.slice(0, CARD_FILES).map((file) => file.path),
          moreFiles: Math.max(0, preview.files.length - CARD_FILES),
        }
      : null,
    items: items.map((item) =>
      cardItem(item, notes.get(item.label) ?? null, preview !== null, settings.reply),
    ),
    skip: [],
  };
  const level = (await resolveChatSettings(deps.db, watch.conversationId)).level;
  if (level === 'full-auto') return perform(deps, watch, action, taskId);
  const card = await askToConfirm(deps, watch, action);
  const replies = action.items.filter((item) => item.reply).length;
  const pushLine = preview ? 'the push and ' : '';
  return {
    ...watch,
    phase: 'confirming',
    approvalId: card.id,
    doing: `Waiting for you to confirm ${pushLine}${replies} ${replies === 1 ? 'reply' : 'replies'}.`,
  };
}

function doneLine(commit: string | null, replies: number, needs: number): string {
  const parts = [
    commit ? `Pushed ${commit.slice(0, 7)}` : null,
    replies > 0 ? `replied on ${replies} ${replies === 1 ? 'thread' : 'threads'}` : null,
  ].filter((part): part is string => part !== null);
  const done = parts.length > 0 ? `${parts.join(' and ')}.` : 'Nothing was pushed.';
  const after = needs > 0 ? ` ${needs} ${needs === 1 ? 'item needs' : 'items need'} you.` : '';
  const head = done.charAt(0).toUpperCase() + done.slice(1);
  return `${head}${after} ${WATCHING_LINE}`;
}

async function perform(
  deps: FollowUpDeps,
  watch: Watch,
  action: PrFollowUpAction,
  taskId: string,
): Promise<Watch> {
  const skip = new Set(action.skip);
  const items = await feedbackFor(deps.db, watch.id, ['planned']);
  const ship = shipDepsOf(deps, watch.workspaceId);
  let commit: string | null = null;
  try {
    if (action.push && !skip.has(PR_PUSH_ITEM)) commit = await pushRound(ship, watch, taskId);
  } catch (error) {
    await updateFeedback(
      deps.db,
      items.map((item) => item.id),
      { state: 'needs_user' },
    );
    return needsYou(watch, `Spark couldn’t push: ${(error as Error).message}`);
  }
  const connection = await connectTo(deps, watch);
  const proposed = new Map(action.items.map((item) => [item.id, item]));
  let replied = 0;
  let needs = 0;
  for (const item of items) {
    if (skip.has(item.id)) {
      await updateFeedback(deps.db, [item.id], { state: 'skipped' });
      continue;
    }
    const unfixed = item.triage !== 'question' && (!commit || builderSkipped(item.reply));
    const unanswered = item.triage === 'question' && !item.reply;
    const wantsReply = proposed.get(item.id)?.reply != null;
    const text = wantsReply ? replyText(item, item.reply, commit?.slice(0, 7) ?? null) : null;
    if (unfixed || unanswered || (text && !connection)) {
      needs += 1;
      await updateFeedback(deps.db, [item.id], { state: 'needs_user' });
      continue;
    }
    const replyId = text && connection ? await postReply(connection, watch, item, text) : null;
    if (replyId) replied += 1;
    await updateFeedback(deps.db, [item.id], { state: 'done', replyId });
  }
  return {
    ...watch,
    phase: needs > 0 ? 'needs_you' : 'watching',
    doing: doneLine(commit, replied, needs),
    roundRunId: null,
    approvalId: null,
  };
}

export async function afterDecision(
  deps: FollowUpDeps,
  watch: Watch,
  approval: Approval,
): Promise<Watch> {
  if (approval.status === 'pending') return watch;
  const action = approval.payload.sparkAction;
  const run = watch.roundRunId ? await roundRun(deps, watch.roundRunId) : null;
  if (approval.status === 'allowed' && action?.action === 'pr_follow_up') {
    const edited = applySparkEdits(action, approval.edits ?? null);
    if (edited.action !== 'pr_follow_up') return watch;
    return perform(deps, watch, edited, run?.taskId ?? watch.taskId);
  }
  const planned = await feedbackFor(deps.db, watch.id, ['planned']);
  await updateFeedback(
    deps.db,
    planned.map((item) => item.id),
    { state: 'skipped' },
  );
  return {
    ...watch,
    phase: 'watching',
    doing: `You declined the push and replies; the changes stay in the chat. ${WATCHING_LINE}`,
    roundRunId: null,
    approvalId: null,
  };
}
