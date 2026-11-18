import { z } from 'zod';
import type {
  GithubInbox,
  GithubInboxItem,
  GithubInboxProblem,
  GithubInboxWindowDays,
} from '@spark-outpost/contracts';
import { pullKeyOf, reviewSummary } from './review/decide.ts';
import { latestReviews } from './review/views.ts';
import type { Db } from '../persistence/db.ts';
import {
  chatsWatchingPulls,
  inboxSeenMarks,
  inboxWindowDays,
  knownTicketsNamed,
  watchKey,
} from '../persistence/github-inbox.ts';
import { listProjects } from '../projects/projects.ts';
import { connectionFor, gitHubReachability, type GitHubDeps } from '../ship/github/access.ts';
import type { GitHubConnection } from '../ship/github/connection.ts';
import { repoSlug } from '../ship/remote.ts';
import { projectRepos, repoKey, type ProjectRepo } from '../tickets/github-pulls.ts';
import { keysIn } from '../tickets/pull-ticket-keys.ts';
import { inboxPulls, seenFlags, type InboxPull } from './group.ts';
import { inboxQuery, parseInboxPage, repoChunks, type InboxRepo } from './search.ts';

const CACHE_MS = 2 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MESSAGE_LIMIT = 200;
const TRUNCATED =
  'Showing the 50 most recently updated pull requests of a search. Open GitHub for the rest.';

interface HostedPull extends InboxPull {
  host: string;
}

interface Snapshot {
  at: number;
  key: string;
  login: string | null;
  fetchedAt: string;
  pulls: HostedPull[];
  problems: GithubInboxProblem[];
}

interface ConnectionGroup {
  connection: GitHubConnection;
  repos: ProjectRepo[];
}

const snapshots = new WeakMap<Db, Map<GithubInboxWindowDays, Snapshot>>();

function cacheFor(db: Db): Map<GithubInboxWindowDays, Snapshot> {
  const found = snapshots.get(db);
  if (found) return found;
  const created = new Map<GithubInboxWindowDays, Snapshot>();
  snapshots.set(db, created);
  return created;
}

const slugOf = (entry: ProjectRepo) => repoSlug(entry.repo);
const problemText = (error: unknown) =>
  (error instanceof Error ? error.message : 'GitHub could not be reached.').slice(0, MESSAGE_LIMIT);

async function groupByConnection(
  deps: GitHubDeps,
  repos: readonly ProjectRepo[],
  problems: GithubInboxProblem[],
): Promise<ConnectionGroup[]> {
  const groups = new Map<string, ConnectionGroup>();
  for (const entry of repos) {
    const connection = await connectionFor(deps, entry.repo).catch(() => null);
    if (!connection) {
      problems.push({
        repo: slugOf(entry),
        message: 'No GitHub connection reaches this repository.',
      });
      continue;
    }
    const key = `${connection.method}:${connection.host}`;
    const group = groups.get(key) ?? { connection, repos: [] };
    group.repos.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

interface Fetched {
  login: string | null;
  pulls: HostedPull[];
  failed: Set<string>;
  problems: GithubInboxProblem[];
}

async function searchChunk(
  connection: GitHubConnection,
  chunk: readonly InboxRepo[],
  since: string,
) {
  const body = await connection.post(
    '/graphql',
    { query: inboxQuery(chunk, since) },
    z.unknown(),
    'searching pull requests',
  );
  return parseInboxPage(body);
}

async function fetchGroup(group: ConnectionGroup, since: string, into: Fetched): Promise<void> {
  const host = group.connection.host;
  const repos = group.repos.map((entry) => ({ owner: entry.repo.owner, name: entry.repo.name }));
  for (const chunk of repoChunks(repos, since)) {
    const keys = chunk.map((repo) => repoKey(host, `${repo.owner}/${repo.name}`));
    const scope = chunk.length === 1 ? `${chunk[0]!.owner}/${chunk[0]!.name}` : null;
    try {
      const page = await searchChunk(group.connection, chunk, since);
      if (page.error) {
        into.problems.push({ repo: scope, message: page.error });
        if (page.pulls.length === 0) keys.forEach((key) => into.failed.add(key));
      }
      if (page.truncated) into.problems.push({ repo: scope, message: TRUNCATED });
      into.login ??= page.viewer;
      const pulls = inboxPulls(page.pulls, page.viewer);
      into.pulls.push(...pulls.map((pull) => ({ ...pull, host })));
    } catch (error) {
      into.problems.push({ repo: scope, message: problemText(error) });
      keys.forEach((key) => into.failed.add(key));
    }
  }
}

function sinceDate(now: number, days: GithubInboxWindowDays): string {
  return new Date(now - days * DAY_MS).toISOString().slice(0, 10);
}

async function fetchSnapshot(
  deps: GitHubDeps,
  repos: readonly ProjectRepo[],
  days: GithubInboxWindowDays,
  key: string,
  previous: Snapshot | undefined,
): Promise<Snapshot> {
  const now = deps.now?.() ?? Date.now();
  const into: Fetched = { login: null, pulls: [], failed: new Set(), problems: [] };
  const groups = await groupByConnection(deps, repos, into.problems);
  const since = sinceDate(now, days);
  for (const group of groups) await fetchGroup(group, since, into);
  const kept = (previous?.pulls ?? []).filter((pull) =>
    into.failed.has(repoKey(pull.host, pull.repo)),
  );
  const stale = previous && into.failed.size > 0 && into.pulls.length === 0;
  return {
    at: now,
    key,
    login: into.login ?? previous?.login ?? null,
    fetchedAt: stale ? previous.fetchedAt : new Date(now).toISOString(),
    pulls: [...into.pulls, ...kept],
    problems: into.problems,
  };
}

const pullAddress = (pull: Pick<HostedPull, 'host' | 'repo' | 'number'>) => {
  const [owner = '', repo = ''] = pull.repo.split('/');
  return { host: pull.host, owner, repo, number: pull.number };
};

async function decorate(
  deps: GitHubDeps,
  snapshot: Snapshot,
  repos: readonly ProjectRepo[],
): Promise<GithubInboxItem[]> {
  const projectOf = new Map(
    repos.map((entry) => [repoKey(entry.repo.host, slugOf(entry)), entry.projectId]),
  );
  const keysOf = new Map(snapshot.pulls.map((pull) => [pull.id, keysIn(pull.headRef, pull.title)]));
  const ids = snapshot.pulls.map((pull) => pull.id);
  const [marks, chats, tickets, reviews] = await Promise.all([
    inboxSeenMarks(deps.db, deps.workspaceId, ids),
    chatsWatchingPulls(deps.db, deps.workspaceId, snapshot.pulls.map(pullAddress)),
    knownTicketsNamed(deps.db, deps.workspaceId, [...keysOf.values()].flat()),
    latestReviews(deps.db, deps.workspaceId, ids),
  ]);
  return snapshot.pulls
    .map(({ host, headRef: _headRef, ...pull }) => {
      const ticketKey = keysOf.get(pull.id)?.find((key) => tickets.has(key.toUpperCase()));
      return {
        ...pull,
        projectId: projectOf.get(repoKey(host, pull.repo)) ?? null,
        conversationId: chats.get(watchKey(pullAddress({ ...pull, host }))) ?? null,
        ticket: ticketKey ? (tickets.get(ticketKey.toUpperCase()) ?? null) : null,
        ...seenFlags(pull.group, pull.headSha, marks.get(pull.id)),
        review: reviewSummary(reviews.get(pullKeyOf(pull.id)), pull.headSha),
      };
    })
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadGithubInbox(
  deps: GitHubDeps,
  options: { refresh?: boolean } = {},
): Promise<GithubInbox> {
  const windowDays = await inboxWindowDays(deps.db, deps.workspaceId);
  const reach = await gitHubReachability(deps).catch(() => ({ saved: false, ghLogin: null }));
  if (!reach.saved && reach.ghLogin === null) {
    return { connected: false, login: null, windowDays, fetchedAt: null, items: [], problems: [] };
  }
  const projects = await listProjects(deps.db, deps.workspaceId).catch(() => []);
  const repos = await projectRepos(projects);
  const key = [
    deps.workspaceId,
    ...repos.map((entry) => `${repoKey(entry.repo.host, slugOf(entry))}=${entry.projectId}`),
  ].join(',');
  const cache = cacheFor(deps.db);
  const now = deps.now?.() ?? Date.now();
  const hit = cache.get(windowDays);
  const usable = hit && hit.key === key && now - hit.at < CACHE_MS && !options.refresh;
  const snapshot = usable
    ? hit
    : await fetchSnapshot(deps, repos, windowDays, key, hit?.key === key ? hit : undefined);
  cache.set(windowDays, snapshot);
  return {
    connected: true,
    login: snapshot.login,
    windowDays,
    fetchedAt: snapshot.fetchedAt,
    items: await decorate(deps, snapshot, repos),
    problems: snapshot.problems,
  };
}
