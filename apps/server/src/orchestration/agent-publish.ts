import { publishRequested } from '../approvals/publish-policy.ts';
import { userText } from '../outposts/user-asked.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import { opensDraftPullRequests } from '../persistence/pr-settings.ts';
import { watchPullRequest } from '../persistence/pr-watches.ts';
import { saveTaskShip } from '../persistence/task-ships.ts';
import { addTaskLink } from '../persistence/tasks.ts';
import { pickRemote } from '../ship/git.ts';
import type { GitHubDeps } from '../ship/github/access.ts';
import { publishedLine, publishedState, type Published } from '../ship/published.ts';
import { repoSlug } from '../ship/remote.ts';
import { syncTicketsAfterShip } from '../tickets/ship-sync.ts';
import { publishScope } from '../workflow/publish-context.ts';
import { publishTurnPrompt } from './context.ts';
import { runMember } from './members.ts';
import type { Session } from './session.ts';

export const NO_OWN_BRANCH_LINE =
  'Not published: this chat has no branch of its own with a remote to push to (it works in your checkout, or the folder has no remote). Use Ship in the Work panel’s Changes tab instead.';

const AGENT_REPLY_CHARS = 1_200;

export interface PublishPlan {
  root: string;
  branch: string;
  base: string | null;
}

export async function agentPublishPlan(s: Session): Promise<PublishPlan | null> {
  const scope = await publishScope(s.deps.db, s.input);
  if (!scope || scope.task.protectedBranches.includes(scope.task.branch)) return null;
  if (!(await pickRemote(scope.root, scope.task.branch))) return null;
  const worktree = await chatWorktreeAt(s.deps.db, scope.root);
  return { root: scope.root, branch: scope.task.branch, base: worktree?.baseBranch ?? null };
}

export function publishAsked(s: Session): boolean {
  return s.input.followUpRound === true || publishRequested(userText(s.input));
}

export interface PublishFacts {
  failing: boolean;
  titlePrefix: string | null;
  notes: readonly string[];
  followUp?: boolean;
  unrelatedFailures?: boolean;
}

function followUpLine(published: Published): string {
  const pull = published.pull ? ` to pull request #${published.pull.number}` : '';
  return published.pushed ? `Pushed the fix${pull}.` : 'The fix was not pushed.';
}

async function record(s: Session, deps: GitHubDeps, plan: PublishPlan, published: Published) {
  const { pull, repo } = published;
  if (!pull || !repo || !s.taskId) return;
  const title = `${repoSlug(repo)}#${pull.number}`;
  await addTaskLink(s.deps.db, s.taskId, { kind: 'pr', url: pull.url, title, source: 'ship' });
  await watchPullRequest(s.deps.db, {
    workspaceId: s.input.workspaceId,
    conversationId: s.input.identity.threadId,
    taskId: s.taskId,
    host: repo.host,
    owner: repo.owner,
    repo: repo.name,
    number: pull.number,
    url: pull.url,
    branch: plan.branch,
  });
  await saveTaskShip(s.deps.db, s.taskId, {
    rootPath: plan.root,
    branch: plan.branch,
    baseBranch: plan.base,
    remote: published.remote,
    lastCommit: published.head,
    pushedAt: new Date(),
    prUrl: pull.url,
    prNumber: pull.number,
  });
  await syncTicketsAfterShip(deps, s.taskId, { url: pull.url, title });
}

export async function publishByAgent(
  s: Session,
  deps: GitHubDeps,
  plan: PublishPlan,
  facts: PublishFacts,
): Promise<string> {
  const draft = facts.failing || (await opensDraftPullRequests(s.deps.db, s.input.workspaceId));
  const followUp = publishTurnPrompt({
    branch: plan.branch,
    draft,
    titlePrefix: facts.titlePrefix,
    notes: facts.notes,
    ...(facts.followUp ? { followUp: true } : {}),
    ...(facts.unrelatedFailures ? { unrelatedFailures: true } : {}),
  });
  const spawn = {
    role: 'builder',
    reason: 'publish',
    escalate: false,
    note: null,
    followUp,
  } as const;
  const { result } = await runMember(s, spawn, null, { publishes: true });
  const published = await publishedState(deps, plan.root, plan.branch, plan.base);
  await record(s, deps, plan, published).catch((error: unknown) =>
    console.error('Could not record the pull request the agent opened', error),
  );
  const line = facts.followUp ? followUpLine(published) : publishedLine(published, plan.branch);
  if (published.pushed && (published.pull || facts.followUp)) return line;
  const said = result.text.trim().slice(0, AGENT_REPLY_CHARS);
  return said ? `${line}\n\n${result.label} reported:\n${said}` : line;
}
