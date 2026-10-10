import {
  agentPublishPlan,
  NO_OWN_BRANCH_LINE,
  parentNotPushedLine,
  type PublishPlan,
} from '../orchestration/agent-publish.ts';
import { NO_PULL_REQUEST } from '../orchestration/no-pull-request.ts';
import type { Session } from '../orchestration/session.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import type { Lease } from '../persistence/jobs.ts';
import { opensDraftPullRequests } from '../persistence/pr-settings.ts';
import { watchesForConversation } from '../persistence/pr-watches.ts';
import { runTask } from '../persistence/tasks.ts';
import { runChanges } from '../projects/run-changes.ts';
import { isGitWorkTree } from '../projects/snapshot.ts';
import { DEFAULT_BRANCH_PREFIX } from '../projects/worktrees.ts';
import { runCommand } from '../setup/command.ts';
import { memorySecretStore } from '../setup/secrets.ts';
import { pickRemote } from '../ship/git.ts';
import type { GitHubDeps } from '../ship/github/access.ts';
import type { ShipDeps } from '../ship/prepare.ts';
import { publishedLine, publishedState } from '../ship/published.ts';
import type { Append, RunControl, TurnDeps, TurnResult } from './agent-turn.ts';
import { closeMessage } from './execute-run.ts';
import { publishPrompt, type PublishReason } from './publish-prompt.ts';
import { promptAgain } from './publish-step-again.ts';
import { commitWithoutRemote } from './publish-step-commit.ts';
import { followUpLine, withLine } from './publish-step-lines.ts';
import { publishReason } from './publish-step-reason.ts';
import { recordPullRequest } from './publish-step-record.ts';
import { branchWork, notPushed, pushedInFull } from './publish-step-work.ts';
import type { RunInput } from './run-input.ts';

export type ShipAccess = Omit<GitHubDeps, 'db' | 'workspaceId'>;

export interface PublishStepDeps extends TurnDeps {
  shipAccess?: ShipAccess;
  branchPrefix?: string;
}

export interface PublishStepTurn {
  lease: Lease;
  input: RunInput;
  append: Append;
  control: Pick<RunControl, 'signal' | 'reason' | 'stop'>;
  reply: TurnResult;
}

interface Publishing extends PublishStepTurn {
  reason: PublishReason;
  ship: ShipDeps;
}

function shipDeps(deps: PublishStepDeps, workspaceId: string): ShipDeps {
  const access = deps.shipAccess ?? {
    secrets: memorySecretStore(),
    runCommand,
    locateGh: async () => null,
    fetch,
  };
  return {
    ...access,
    db: deps.db,
    workspaceId,
    branchPrefix: deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
  };
}

async function changedFiles(turn: Publishing): Promise<boolean> {
  const { db, workspaceId } = turn.ship;
  const changes = await runChanges(db, workspaceId, turn.lease.runId, true);
  return changes.files.length > 0;
}

async function keptWithout(turn: Publishing, line: string): Promise<TurnResult> {
  const says = turn.reason !== 'follow-up' && (await changedFiles(turn));
  return withLine(turn.append, turn.reply, says ? line : null);
}

async function committedLocally(turn: Publishing): Promise<TurnResult> {
  if (turn.reason === 'follow-up') return turn.reply;
  const line = await commitWithoutRemote(turn.ship, {
    runId: turn.lease.runId,
    request: turn.input.userRequest,
    reply: turn.reply.text,
  });
  return withLine(turn.append, turn.reply, line);
}

async function hasOpenPull(turn: Publishing, plan: PublishPlan): Promise<boolean> {
  const { db, workspaceId } = turn.ship;
  const watches = await watchesForConversation(db, workspaceId, turn.input.identity.threadId);
  if (watches.some((watch) => watch.prState === 'open' && watch.branch === plan.branch)) {
    return true;
  }
  const published = await publishedState(turn.ship, plan.root, plan.branch, plan.base);
  return published.pull !== null || published.unknown !== null;
}

async function unpublishedWork(
  turn: Publishing,
  plan: PublishPlan,
  baseCommit: string,
): Promise<boolean> {
  const work = await branchWork(plan.root, plan.branch, baseCommit);
  if (notPushed(work)) return true;
  if (turn.reason === 'follow-up' || !pushedInFull(work)) return false;
  return !(await hasOpenPull(turn, plan));
}

async function publishedByAgent(
  deps: PublishStepDeps,
  turn: Publishing,
  plan: PublishPlan,
): Promise<TurnResult> {
  const { db, workspaceId } = turn.ship;
  const prompt = publishPrompt({
    branch: plan.branch,
    unpublishedWork: true,
    reason: turn.reason,
    draftAsked: await opensDraftPullRequests(db, workspaceId),
    pullBase: plan.pullBase,
  });
  if (!prompt) return turn.reply;
  await closeMessage(turn.append, turn.reply, true);
  const said = await promptAgain(deps, turn, prompt);
  if (said.outcome !== 'succeeded') return said;
  const published = await publishedState(turn.ship, plan.root, plan.branch, plan.base);
  const chat = {
    workspaceId,
    conversationId: turn.input.identity.threadId,
    taskId: (await runTask(db, turn.lease.runId))?.taskId ?? null,
  };
  await recordPullRequest(turn.ship, chat, plan, published).catch((error: unknown) =>
    console.error('Could not record the pull request the agent opened', error),
  );
  const followUp = turn.reason === 'follow-up';
  const line = followUp ? followUpLine(published) : publishedLine(published, plan.branch);
  return withLine(turn.append, said, line);
}

export async function publishStep(
  deps: PublishStepDeps,
  step: PublishStepTurn,
): Promise<TurnResult> {
  const { input, reply } = step;
  if (reply.outcome !== 'succeeded' || step.control.signal.aborted) return reply;
  const reason = publishReason(input);
  if (!reason) return reply;
  const turn: Publishing = { ...step, reason, ship: shipDeps(deps, input.workspaceId) };
  const root = input.projectRoots[0] ?? null;
  if (!root) return reply;
  if (!(await isGitWorkTree(root))) return keptWithout(turn, NO_PULL_REQUEST.notGit);
  const worktree = await chatWorktreeAt(deps.db, root);
  if (!worktree?.ownsBranch) return keptWithout(turn, NO_OWN_BRANCH_LINE);
  if (!(await pickRemote(root, worktree.branch))) return committedLocally(turn);
  const plan = await agentPublishPlan({ deps: { db: deps.db }, input } as Session);
  if (!plan || !(await unpublishedWork(turn, plan, worktree.baseCommit))) return reply;
  if (plan.stackBase && !plan.stackBase.onRemote) {
    return withLine(step.append, reply, parentNotPushedLine(plan.stackBase));
  }
  return publishedByAgent(deps, turn, plan);
}
