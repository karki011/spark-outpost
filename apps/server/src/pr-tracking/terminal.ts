import { findTrackedPull, type Tracked } from '../persistence/tracked-pulls.ts';
import { readPullFacts, type PullFacts } from '../pr-follow-up/gather.ts';
import { connectionFor, type GitHubDeps } from '../ship/github/access.ts';
import type { GitHubConnection } from '../ship/github/connection.ts';
import type { TerminalPullRequest } from '../terminal/pull-request-scan.ts';
import { checkedOutHere, chatRepos } from './chat-repos.ts';
import { pullAddress, trackChatPull } from './track.ts';

const OPENED_SLACK_MS = 2 * 60_000;

async function openedByMe(
  connection: GitHubConnection,
  facts: PullFacts,
  shellOpenedAt: Date,
): Promise<boolean> {
  const created = facts.createdAt ? Date.parse(facts.createdAt) : Number.NaN;
  if (!(created >= shellOpenedAt.getTime() - OPENED_SLACK_MS)) return false;
  const me = await connection.whoami().catch(() => null);
  return me !== null && me.login.toLowerCase() === facts.author?.toLowerCase();
}

export async function trackTerminalPull(
  deps: GitHubDeps,
  sighting: TerminalPullRequest,
): Promise<Tracked | null> {
  const address = pullAddress(sighting.url);
  if (!address) return null;
  if (await findTrackedPull(deps.db, deps.workspaceId, address)) return null;
  const repo = { host: address.host, owner: address.owner, name: address.repo };
  const connection = await connectionFor(deps, repo).catch(() => null);
  if (!connection) return null;
  const facts = await readPullFacts(connection, repo, address.number).catch(() => null);
  if (!facts) return null;
  const repos = await chatRepos(deps.db, sighting.conversationId);
  const fromChatBranch = facts.head !== null && checkedOutHere(repos, address, facts.head);
  if (!fromChatBranch && !(await openedByMe(connection, facts, sighting.shellOpenedAt))) {
    return null;
  }
  return trackChatPull(deps.db, {
    conversationId: sighting.conversationId,
    url: sighting.url,
    via: 'terminal',
    by: 'terminal',
    runId: null,
    taskId: null,
    head: facts.head,
    base: facts.base,
    title: facts.title,
    draft: facts.draft,
  });
}

export function terminalPullTracker(deps: GitHubDeps): (sighting: TerminalPullRequest) => void {
  let work: Promise<unknown> = Promise.resolve();
  return (sighting) => {
    work = work
      .then(() => trackTerminalPull(deps, sighting))
      .catch((error: unknown) =>
        console.error('Could not track a pull request seen in a terminal', error),
      );
  };
}
