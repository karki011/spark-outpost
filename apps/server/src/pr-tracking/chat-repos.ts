import { stat } from 'node:fs/promises';
import { chatWorktreesOf, type ChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import type { PullAddress } from '../persistence/tracked-pulls.ts';
import { pickRemote, runGit } from '../ship/git.ts';
import { parseRemoteUrl, type RemoteRepo } from '../ship/remote.ts';

export interface ChatBranch {
  name: string;
  owned: boolean;
}

export interface ChatRepo {
  repo: RemoteRepo;
  branches: ChatBranch[];
}

const SHARED_BRANCHES = new Set(['main', 'master', 'develop', 'trunk']);

async function isFolder(target: string): Promise<boolean> {
  return stat(target).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

async function remoteRepo(root: string, branch: string | null): Promise<RemoteRepo | null> {
  if (!(await isFolder(root))) return null;
  const remote = await pickRemote(root, branch).catch(() => null);
  return remote ? parseRemoteUrl(remote.url) : null;
}

async function checkedOut(root: string): Promise<string | null> {
  const result = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(
    () => null,
  );
  return result && result.code === 0 ? result.stdout.trim() || null : null;
}

async function worktreeBranches(worktree: ChatWorktree): Promise<ChatBranch[]> {
  const shared = (name: string) => SHARED_BRANCHES.has(name) || name === worktree.baseBranch;
  const branches: ChatBranch[] = [];
  if (!shared(worktree.branch)) {
    branches.push({ name: worktree.branch, owned: worktree.ownsBranch });
  }
  const current = await checkedOut(worktree.path);
  if (current && current !== worktree.branch && !shared(current)) {
    branches.push({ name: current, owned: false });
  }
  return branches;
}

export const sameRepo = (a: RemoteRepo, b: RemoteRepo) =>
  a.host.toLowerCase() === b.host.toLowerCase() &&
  a.owner.toLowerCase() === b.owner.toLowerCase() &&
  a.name.toLowerCase() === b.name.toLowerCase();

function add(repos: ChatRepo[], repo: RemoteRepo, branches: readonly ChatBranch[]) {
  const known = repos.find((entry) => sameRepo(entry.repo, repo));
  if (!known) {
    repos.push({ repo, branches: [...branches] });
    return;
  }
  for (const branch of branches) {
    if (!known.branches.some((entry) => entry.name === branch.name)) known.branches.push(branch);
  }
}

async function linkedRoots(db: Queryable, conversationId: string): Promise<string[]> {
  const { rows } = await db.query<{ root_path: string }>(
    `SELECT p.root_path FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
     WHERE cp.conversation_id = $1 ORDER BY cp.position, cp.created_at`,
    [conversationId],
  );
  return rows.map((row) => row.root_path);
}

export async function chatRepos(db: Queryable, conversationId: string): Promise<ChatRepo[]> {
  const repos: ChatRepo[] = [];
  for (const worktree of await chatWorktreesOf(db, conversationId)) {
    const repo = await remoteRepo(worktree.path, worktree.branch);
    if (repo) add(repos, repo, await worktreeBranches(worktree));
  }
  for (const root of await linkedRoots(db, conversationId)) {
    const repo = await remoteRepo(root, null);
    if (repo) add(repos, repo, []);
  }
  return repos;
}

const repoOf = (address: PullAddress): RemoteRepo => ({
  host: address.host,
  owner: address.owner,
  name: address.repo,
});

export function chatRepoOf(repos: readonly ChatRepo[], address: PullAddress): ChatRepo | null {
  return repos.find((entry) => sameRepo(entry.repo, repoOf(address))) ?? null;
}

export function ownedBranch(
  repos: readonly ChatRepo[],
  address: PullAddress,
  head: string | null,
): string | null {
  const owned = (chatRepoOf(repos, address)?.branches ?? []).filter((branch) => branch.owned);
  if (head === null) return owned[0]?.name ?? null;
  return owned.some((branch) => branch.name === head) ? head : null;
}

export function checkedOutHere(
  repos: readonly ChatRepo[],
  address: PullAddress,
  head: string,
): boolean {
  return (chatRepoOf(repos, address)?.branches ?? []).some((branch) => branch.name === head);
}
