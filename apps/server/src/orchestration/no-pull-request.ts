import { connectionsFor } from '../ship/github/access.ts';
import { pickRemote, repoState } from '../ship/git.ts';
import { parseRemoteUrl } from '../ship/remote.ts';
import { KEPT_BY_AUTO_EDIT } from './checkpoint-policy.ts';
import { sessionReviewLine } from './critic-fix.ts';
import { autoKeep, publishWhenAsked } from './full-auto-ship.ts';
import type { Session } from './session.ts';
import type { FlowEvent } from './transitions.ts';

export const NO_PULL_REQUEST = {
  noProject: 'No pull request: this chat has no project.',
  notGit: 'No pull request: this project isn’t a git repository.',
  noGitHubRemote: 'No pull request: this project has no GitHub remote.',
  notConnected: 'No pull request: GitHub isn’t connected.',
};

const GITHUB_HOST = 'github.com';

export interface PullRequestFacts {
  hasProject: boolean;
  git: boolean;
  remoteHost: string | null;
  connected: boolean;
}

export function noPullRequestLine(facts: PullRequestFacts): string | null {
  if (!facts.hasProject) return NO_PULL_REQUEST.noProject;
  if (!facts.git) return NO_PULL_REQUEST.notGit;
  if (facts.connected) return null;
  if (facts.remoteHost !== GITHUB_HOST) return NO_PULL_REQUEST.noGitHubRemote;
  return NO_PULL_REQUEST.notConnected;
}

async function pullRequestFacts(s: Session): Promise<PullRequestFacts> {
  const root = s.input.projectRoots[0] ?? null;
  const repo = root && s.git ? await repoState(root) : null;
  if (!root || !repo) {
    return { hasProject: root !== null, git: false, remoteHost: null, connected: false };
  }
  const remote = await pickRemote(root, repo.branch);
  const parsed = remote ? parseRemoteUrl(remote.url) : null;
  const access = s.deps.shipAccess;
  const connections =
    parsed && access
      ? await connectionsFor({ ...access, db: s.deps.db, workspaceId: s.input.workspaceId }, parsed)
      : [];
  return {
    hasProject: true,
    git: true,
    remoteHost: parsed?.host ?? null,
    connected: connections.length > 0,
  };
}

export async function keepWithoutPullRequest(
  s: Session,
  keptNote: string | null,
): Promise<FlowEvent | null> {
  const facts = await pullRequestFacts(s).catch(() => null);
  const line = facts ? noPullRequestLine(facts) : null;
  if (line === null) return null;
  s.shipLine = line;
  await autoKeep(s, 'hands-off', [keptNote ?? KEPT_BY_AUTO_EDIT, sessionReviewLine(s), line]);
  await publishWhenAsked(s);
  return { type: 'kept' };
}
