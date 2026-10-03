import type { GitHubTestResult, PrRouteInfo } from '@spark-outpost/contracts';
import { primaryChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { listProjects } from '../projects/projects.ts';
import { shipFailureMessage } from './failure-hint.ts';
import { listRemoteHeads, pickRemote } from './git.ts';
import { connectionsFor, type GitHubDeps } from './github/access.ts';
import { prRouteFor } from './pr-route.ts';
import { withCredentials } from './push.ts';
import { parseRemoteUrl, repoSlug } from './remote.ts';

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; info: Promise<PrRouteInfo> }>();

export function forgetPrRoutes(): void {
  cache.clear();
}

async function checkRoute(deps: GitHubDeps, root: string): Promise<PrRouteInfo> {
  const remote = await pickRemote(root, null).catch(() => null);
  const repo = remote ? parseRemoteUrl(remote.url) : null;
  const methods = repo ? (await connectionsFor(deps, repo.host)).map((c) => c.method) : [];
  const route = prRouteFor({
    hasRemote: remote !== null,
    repo,
    token: methods.includes('token'),
    gh: methods.includes('gh_cli'),
  });
  return { route, host: repo?.host ?? null, repo: repo ? repoSlug(repo) : null };
}

export function prRouteAt(deps: GitHubDeps, root: string, now = Date.now()): Promise<PrRouteInfo> {
  const key = `${deps.workspaceId}:${root}`;
  const known = cache.get(key);
  if (known && now - known.at < CACHE_MS) return known.info;
  const info = checkRoute(deps, root);
  cache.set(key, { at: now, info });
  info.catch(() => cache.delete(key));
  return info;
}

async function chatRoot(db: Queryable, conversationId: string): Promise<string | null> {
  const worktree = await primaryChatWorktree(db, conversationId);
  if (worktree) return worktree.path;
  const { rows } = await db.query<{ root: string }>(
    `(SELECT p.root_path AS root FROM conversation_projects cp
      JOIN projects p ON p.id = cp.project_id
      WHERE cp.conversation_id = $1 ORDER BY cp.position, cp.created_at LIMIT 1)
     UNION ALL
     (SELECT snapshot_root FROM runs WHERE conversation_id = $1 AND snapshot_root IS NOT NULL
      ORDER BY created_at DESC LIMIT 1)`,
    [conversationId],
  );
  return rows[0]?.root ?? null;
}

export async function conversationPrRoute(
  deps: GitHubDeps,
  conversationId: string,
): Promise<PrRouteInfo | null> {
  const root = await chatRoot(deps.db, conversationId);
  return root ? prRouteAt(deps, root) : null;
}

const REACHED = {
  git: 'Reached the remote with your git login',
  token: 'Reached the remote with the GitHub connection',
} as const;

async function signedIn(deps: GitHubDeps, host: string | null): Promise<string> {
  const [first] = host ? await connectionsFor(deps, host) : [];
  if (!first) return '';
  const who = await first.whoami().catch(() => null);
  return who ? ` · signed in to ${host} as ${who.login}` : ` · ${host} sign-in failed`;
}

async function testProject(deps: GitHubDeps, name: string, root: string) {
  const info = await prRouteAt(deps, root);
  const remote = await pickRemote(root, null).catch(() => null);
  if (!remote) {
    return { project: name, remote: null, route: info.route, reach: 'none' as const, detail: '' };
  }
  try {
    const via = await withCredentials(deps, remote, (access) =>
      listRemoteHeads(root, remote.name, access),
    );
    const detail = `${REACHED[via]}${await signedIn(deps, info.host)}`;
    return { project: name, remote: remote.name, route: info.route, reach: via, detail };
  } catch (error) {
    const detail = shipFailureMessage(error);
    return {
      project: name,
      remote: remote.name,
      route: info.route,
      reach: 'failed' as const,
      detail,
    };
  }
}

export async function testGitHub(deps: GitHubDeps): Promise<GitHubTestResult> {
  forgetPrRoutes();
  const projects = await listProjects(deps.db, deps.workspaceId);
  return {
    projects: await Promise.all(
      projects.map((project) => testProject(deps, project.name, project.rootPath)),
    ),
  };
}
