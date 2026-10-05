import type { PublishBasis, TaskBranch } from '../approvals/publish-policy.ts';
import { otherBranchReason } from '../approvals/publish-policy.ts';
import { trustFor } from '../agent-config/trust-store.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import type { ProtocolObserver } from '../providers/provider.ts';
import { pushFailureDetail, shipFailureMessage } from './failure-hint.ts';
import { harnessCommitsToPush, pickRemote, ShipGitError } from './git.ts';
import type { GitHubDeps } from './github/access.ts';
import { PushStoppedError } from './push-branch.ts';
import { pushOwnBranch } from './push.ts';
import { parseRemoteUrl, repoSlug } from './remote.ts';

export const AGENT_PUSH_METHOD = 'ship/agent_push';

export interface PublishScope {
  basis: PublishBasis;
  task: TaskBranch;
  root: string;
}

export type AgentPushOutcome = 'pushed' | 'failed' | 'cancelled' | 'timed_out' | 'refused';

export interface AgentPush {
  outcome: AgentPushOutcome;
  branch: string;
  remote: string | null;
  repo: string | null;
  via: string | null;
  message: string;
  stoppedBy: string | null;
  output: string;
  secretsWithheld: boolean;
}

export interface AgentPushOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  audit?: ProtocolObserver | undefined;
}

export const UNTRUSTED_FOLDER_NOTE =
  "This folder is marked Not trusted in Settings → Projects, so its hooks ran without the user's token and key variables.";

async function withholdsSecrets(deps: GitHubDeps, root: string): Promise<boolean> {
  const worktree = await chatWorktreeAt(deps.db, root);
  if (!worktree) return false;
  const trust = (await trustFor(deps.db, [worktree.projectId])).get(worktree.projectId);
  return trust !== undefined && !trust.trusted;
}

function outcomeOf(error: unknown): AgentPushOutcome {
  if (error instanceof PushStoppedError) return error.ended;
  return 'failed';
}

function record(options: AgentPushOptions, basis: PublishBasis, push: AgentPush, names: string[]) {
  options.audit?.message('harness', {
    method: AGENT_PUSH_METHOD,
    params: { ...push, basis, environment: 'login shell', secretVariablesPassed: names },
  });
}

export async function pushForAgent(
  deps: GitHubDeps,
  publish: PublishScope,
  options: AgentPushOptions = {},
): Promise<AgentPush> {
  const { branch } = publish.task;
  const base: AgentPush = {
    outcome: 'refused',
    branch,
    remote: null,
    repo: null,
    via: null,
    message: '',
    stoppedBy: null,
    output: '',
    secretsWithheld: false,
  };
  const refuse = (message: string, remote: string | null = null): AgentPush => {
    const refused = { ...base, remote, message };
    record(options, publish.basis, refused, []);
    return refused;
  };
  if (publish.task.protectedBranches.includes(branch)) return refuse(otherBranchReason(branch));
  const remote = await pickRemote(publish.root, branch);
  if (!remote) return refuse('This folder has no git remote to push to.');
  const internal = await harnessCommitsToPush(publish.root, remote.name, branch);
  if (internal.length > 0) {
    return refuse(
      `${branch} carries Spark's internal commits (${internal.slice(0, 3).join('; ')}), so it was not pushed.`,
      remote.name,
    );
  }
  const hosted = parseRemoteUrl(remote.url);
  const secretsWithheld = await withholdsSecrets(deps, publish.root);
  const known = { ...base, remote: remote.name, repo: hosted ? repoSlug(hosted) : null };
  try {
    const pushed = await pushOwnBranch(deps, publish.root, remote, branch, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      withholdSecrets: secretsWithheld,
    });
    const done: AgentPush = {
      ...known,
      outcome: 'pushed',
      via: pushed.route,
      message: `Pushed ${branch} to ${remote.name}.`,
      output: pushed.output,
      secretsWithheld,
    };
    record(options, publish.basis, done, pushed.secretNames);
    return done;
  } catch (error) {
    const output = error instanceof ShipGitError ? error.output : '';
    const failed: AgentPush = {
      ...known,
      outcome: outcomeOf(error),
      message: [shipFailureMessage(error), secretsWithheld ? UNTRUSTED_FOLDER_NOTE : null]
        .filter(Boolean)
        .join(' '),
      stoppedBy: pushFailureDetail(error)?.hook ?? null,
      output,
      secretsWithheld,
    };
    record(options, publish.basis, failed, []);
    return failed;
  }
}
