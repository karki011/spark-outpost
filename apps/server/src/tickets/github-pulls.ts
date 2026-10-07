import { z } from 'zod';
import type { Db } from '../persistence/db.ts';
import { listProjects } from '../projects/projects.ts';
import { pickRemote } from '../ship/git.ts';
import { connectionFor, gitHubStatus, type GitHubDeps } from '../ship/github/access.ts';
import { repoPath } from '../ship/github/connection.ts';
import { parseRemoteUrl, repoSlug, type RemoteRepo } from '../ship/remote.ts';
import type { SourcePull } from './source.ts';

const CACHE_MS = 2 * 60_000;
const MAX_REPOS = 10;
const TEXT_LIMIT = 300;

const openPullsSchema = z.array(
  z.object({
    html_url: z.string().url(),
    number: z.number().int().positive(),
    title: z.string(),
    draft: z.boolean().optional(),
    updated_at: z.string().optional(),
    user: z.object({ login: z.string() }).nullable().optional(),
    head: z.object({ ref: z.string() }),
  }),
);

interface CachedPulls {
  at: number;
  projects: string;
  pulls: SourcePull[];
}

const pullCache = new WeakMap<Db, CachedPulls>();

async function reposOf(roots: readonly string[]): Promise<RemoteRepo[]> {
  const repos = new Map<string, RemoteRepo>();
  for (const root of roots) {
    const remote = await pickRemote(root, null).catch(() => null);
    const repo = remote ? parseRemoteUrl(remote.url) : null;
    if (repo) repos.set(`${repo.host}/${repoSlug(repo)}`.toLowerCase(), repo);
  }
  return [...repos.values()].slice(0, MAX_REPOS);
}

async function openPullsIn(deps: GitHubDeps, repo: RemoteRepo): Promise<SourcePull[]> {
  const connection = await connectionFor(deps, repo).catch(() => null);
  if (!connection) return [];
  const pulls = await connection
    .get(
      `${repoPath(repo)}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
      openPullsSchema,
      'listing open pull requests',
    )
    .catch(() => []);
  return pulls.map((pull) => ({
    url: pull.html_url,
    title: pull.title.slice(0, TEXT_LIMIT),
    state: pull.draft ? 'draft' : 'open',
    branch: pull.head.ref.slice(0, TEXT_LIMIT),
    author: pull.user?.login ?? null,
    updatedAt: pull.updated_at ?? null,
    repo: repoSlug(repo),
    number: pull.number,
  }));
}

export async function projectOpenPulls(deps: GitHubDeps): Promise<SourcePull[]> {
  const projects = await listProjects(deps.db, deps.workspaceId).catch(() => []);
  const fingerprint = projects.map((project) => project.id).join(',');
  const now = deps.now?.() ?? Date.now();
  const hit = pullCache.get(deps.db);
  if (hit && hit.projects === fingerprint && now - hit.at < CACHE_MS) return hit.pulls;
  const repos = await reposOf(projects.map((project) => project.rootPath));
  const pulls = (await Promise.all(repos.map((repo) => openPullsIn(deps, repo)))).flat();
  pullCache.set(deps.db, { at: now, projects: fingerprint, pulls });
  return pulls;
}

export async function myGitHubLogins(deps: GitHubDeps): Promise<Set<string>> {
  const status = await gitHubStatus(deps).catch(() => null);
  const logins = [status?.app.login, status?.token?.login, status?.ghCli.login];
  return new Set(logins.flatMap((login) => (login ? [login.toLowerCase()] : [])));
}

function keyPattern(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i');
}

export function pullsMatchingKey(key: string, pulls: readonly SourcePull[]): SourcePull[] {
  const pattern = keyPattern(key);
  return pulls.filter((pull) => pattern.test(pull.branch ?? '') || pattern.test(pull.title ?? ''));
}
