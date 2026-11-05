import { pickRemote, runGit } from './git.ts';
import { connectionsFor, type GitHubDeps } from './github/access.ts';
import type { PullRequest } from './github/connection.ts';
import { pullRequestLink } from './pr-route.ts';
import { parseRemoteUrl, repoSlug, type RemoteRepo } from './remote.ts';

export interface PushedHead {
  head: string | null;
  pushed: boolean;
}

export interface Published {
  pushed: boolean;
  head: string | null;
  remote: string | null;
  repo: RemoteRepo | null;
  pull: PullRequest | null;
  createUrl: string | null;
  unknown: string | null;
}

async function revision(root: string, ref: string): Promise<string | null> {
  const result = await runGit(root, ['rev-parse', '--verify', '-q', ref]);
  return result.code === 0 ? result.stdout.trim() || null : null;
}

async function pullFor(deps: GitHubDeps, repo: RemoteRepo, branch: string) {
  let unknown: string | null = `GitHub is not connected for ${repo.host}.`;
  for (const github of await connectionsFor(deps, repo)) {
    try {
      return { pull: await github.findPullRequest(repo, branch), unknown: null };
    } catch (error) {
      unknown = error instanceof Error ? error.message : String(error);
    }
  }
  return { pull: null, unknown };
}

export async function pushedHead(root: string, branch: string): Promise<PushedHead> {
  const remote = await pickRemote(root, branch);
  const head = await revision(root, `refs/heads/${branch}`);
  const sent = remote ? await revision(root, `refs/remotes/${remote.name}/${branch}`) : null;
  return { head, pushed: head !== null && head === sent };
}

export async function publishedState(
  deps: GitHubDeps,
  root: string,
  branch: string,
  base: string | null,
): Promise<Published> {
  const remote = await pickRemote(root, branch);
  const repo = remote ? parseRemoteUrl(remote.url) : null;
  const { head: local, pushed } = await pushedHead(root, branch);
  const known = { pushed, head: local, remote: remote?.name ?? null, repo };
  if (!repo) return { ...known, pull: null, createUrl: null, unknown: null };
  const { pull, unknown } = await pullFor(deps, repo, branch);
  const link = base ? pullRequestLink(repo, base, branch, { title: '', body: '' }) : null;
  return { ...known, pull, createUrl: pull ? null : (link?.url ?? null), unknown };
}

export const PUSHED_WITHOUT_PR = 'The branch was pushed, but no pull request was opened.';

export function publishedLine(published: Published, branch: string): string {
  const { pull, repo } = published;
  if (pull) {
    return `Opened pull request #${pull.number}: ${pull.url}\n\nThe change is on ${branch} in this chat's worktree.`;
  }
  if (published.pushed) {
    const create = published.createUrl ? ` Create it: ${published.createUrl}` : '';
    const why = published.unknown ? ` Spark could not check GitHub: ${published.unknown}` : '';
    return `${PUSHED_WITHOUT_PR}${create}${why}`;
  }
  const where = repo ? ` to ${repoSlug(repo)}` : '';
  return `${branch} was not pushed${where}, so there is no pull request.`;
}
