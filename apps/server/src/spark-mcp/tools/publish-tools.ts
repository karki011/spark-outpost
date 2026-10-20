import { z } from 'zod';
import { SPARK_TEXT_MAX, SPARK_TITLE_MAX } from '@spark-outpost/contracts';
import { chatWorktreeAt } from '../../persistence/chat-worktrees.ts';
import { opensDraftPullRequests } from '../../persistence/pr-settings.ts';
import { pushForAgent, type PublishScope } from '../../ship/agent-push.ts';
import { pickRemote, remoteHasBranch } from '../../ship/git.ts';
import { connectionsFor } from '../../ship/github/access.ts';
import { GitHubApiError, type GitHubConnection } from '../../ship/github/connection.ts';
import { parseRemoteUrl, repoSlug, type RemoteRepo } from '../../ship/remote.ts';
import { gitHubDepsFor } from '../deps.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

export const NOT_AUTHORIZED =
  "Publishing isn't authorized in this turn. It needs the user's message to ask for a push or pull request, the chat at Full auto → PR, or an Auto or Bypass permissions (Full access) mode, in a chat working on its own spark/ branch or the pull request branch the user adopted for it. Leave the change in the working tree and tell the user.";

export const PUSH_ONLY =
  "The user's message asked for the push and no pull request, and nothing else in this turn allows one. Tell the user the branch is pushed.";

function authorized(context: SparkToolContext): PublishScope {
  const publish = context.scope.publish;
  if (!publish) throw new SparkToolError(NOT_AUTHORIZED);
  return publish;
}

function nextAfterPush(publish: PublishScope): string {
  return publish.pushOnly
    ? 'Tell the user the branch is pushed. Do not open a pull request: the user asked for the push only.'
    : 'Open the pull request now (gh pr create, or spark_pull_request when you have it) and give the user its link.';
}

async function push(context: SparkToolContext) {
  const publish = authorized(context);
  const result = await pushForAgent(gitHubDepsFor(context.deps, context.scope), publish, {
    signal: context.signal,
    audit: context.scope.actions?.audit,
  });
  const pushed = result.outcome === 'pushed';
  return {
    pushed,
    outcome: result.outcome,
    branch: result.branch,
    remote: result.remote,
    repo: result.repo,
    message: result.message,
    ...(result.stoppedBy ? { stoppedBy: result.stoppedBy } : {}),
    output: result.output,
    next: pushed
      ? nextAfterPush(publish)
      : 'Nothing was pushed. Read the output: fix what your change caused and call this again; otherwise tell the user exactly what is needed.',
  };
}

export const pushTool = sparkTool({
  name: 'spark_push',
  title: 'Push this chat’s branch',
  acts: true,
  needs: 'publish',
  description:
    "Push this chat's own branch (its spark/ branch, or the pull request branch the user adopted for it) to its remote, run by Spark in the user's login-shell environment so the repository's pre-push hook has the registry and tool logins a terminal has (your own shell does not). Use it instead of `git push` when publishing is authorized. Never skips hooks, never force-pushes, pushes no other branch. Returns whether it pushed and the last lines of git and hook output with secrets hidden; a hook can take minutes.",
  input: {},
  run: (_args, context) => push(context),
});

interface Target {
  repo: RemoteRepo;
  base: string | null;
}

async function target(context: SparkToolContext, publish: PublishScope): Promise<Target> {
  const { root, task } = publish;
  const remote = await pickRemote(root, task.branch);
  const repo = remote ? parseRemoteUrl(remote.url) : null;
  if (!remote || !repo) throw new SparkToolError('This folder has no GitHub remote.');
  if (!(await remoteHasBranch(root, remote.name, task.branch))) {
    throw new SparkToolError(
      `${task.branch} is not on ${remote.name} yet. Push it first with spark_push, then call this again.`,
    );
  }
  const worktree = await chatWorktreeAt(context.deps.db, root);
  return { repo, base: task.pullBase ?? worktree?.baseBranch ?? null };
}

interface PullText {
  title: string;
  body: string;
  draft: boolean;
}

async function openWith(github: GitHubConnection, at: Target, head: string, text: PullText) {
  const existing = await github.findPullRequest(at.repo, head);
  if (existing) {
    const pull = await github.updatePullRequest(at.repo, existing.number, text);
    return { pull, created: false };
  }
  const base = at.base ?? (await github.defaultBranch(at.repo));
  if (base === head) throw new SparkToolError('The branch and its base are the same.');
  return { pull: await github.createPullRequest(at.repo, { ...text, head, base }), created: true };
}

const refusedSignIn = (error: unknown) =>
  error instanceof GitHubApiError && (error.status === 401 || error.status === 403);

async function pullRequest(
  context: SparkToolContext,
  args: { title: string; body: string; draft?: boolean | undefined },
) {
  const publish = authorized(context);
  if (!publish.opensPull) throw new SparkToolError(PUSH_ONLY);
  const deps = gitHubDepsFor(context.deps, context.scope);
  const at = await target(context, publish);
  const draft = args.draft ?? (await opensDraftPullRequests(deps.db, deps.workspaceId));
  const text = { title: args.title, body: args.body, draft };
  let refused: unknown = null;
  for (const github of await connectionsFor(deps, at.repo)) {
    try {
      const { pull, created } = await openWith(github, at, publish.task.branch, text);
      return {
        url: pull.url,
        number: pull.number,
        repo: repoSlug(at.repo),
        created,
        ...(created ? { draft } : {}),
        message: `${created ? 'Opened' : 'Updated'} pull request #${pull.number}. Give the user its link.`,
      };
    } catch (error) {
      if (error instanceof SparkToolError || !refusedSignIn(error)) {
        throw error instanceof GitHubApiError ? new SparkToolError(error.message) : error;
      }
      refused = error;
    }
  }
  throw new SparkToolError(
    refused instanceof Error
      ? `${refused.message} Ask the user to reconnect GitHub in Settings → Connectors.`
      : `GitHub is not connected for ${at.repo.host}. Ask the user to connect it in Settings → Connectors.`,
  );
}

export const pullRequestTool = sparkTool({
  name: 'spark_pull_request',
  title: 'Open or update the pull request',
  acts: true,
  needs: 'pull_request_create',
  description:
    "Create the pull request for this chat's own, already pushed spark/ branch through Spark's GitHub connection, or update its title and description when it exists. Offered because `gh` is not signed in here; push first with spark_push. Runs without a card when publishing is authorized, and refuses otherwise. Nothing merges. Returns the PR URL and number.",
  input: {
    title: z.string().trim().min(1).max(SPARK_TITLE_MAX),
    body: z.string().max(SPARK_TEXT_MAX).default('').describe('What changed and why.'),
    draft: z.boolean().optional().describe('Defaults to Settings → Spark → Open pull requests as.'),
  },
  run: (args, context) => pullRequest(context, args),
});

export const publishTools = [pushTool, pullRequestTool];
