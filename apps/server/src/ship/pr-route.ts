import type { PrLink, PrRoute } from '@spark-outpost/contracts';
import { repoSlug, type RemoteRepo } from './remote.ts';

export interface RouteFacts {
  hasRemote: boolean;
  repo: RemoteRepo | null;
  app: boolean;
  token: boolean;
  gh: boolean;
}

export function prRouteFor(facts: RouteFacts): PrRoute {
  if (!facts.hasRemote) return 'commit';
  if (!facts.repo) return 'push';
  if (facts.app) return 'app';
  if (facts.token) return 'token';
  if (facts.gh) return 'gh_cli';
  return linkKind(facts.repo) ? 'link' : 'push';
}

type LinkKind = 'github' | 'gitlab' | 'bitbucket';

function linkKind(repo: RemoteRepo): LinkKind | null {
  if (repo.host === 'github.com') return 'github';
  if (repo.host === 'bitbucket.org') return 'bitbucket';
  if (repo.host === 'gitlab.com' || repo.host.startsWith('gitlab.')) return 'gitlab';
  return null;
}

const BODY_MAX_CHARS = 3000;

function clipped(text: string): string {
  return text.length <= BODY_MAX_CHARS ? text : `${text.slice(0, BODY_MAX_CHARS - 1)}…`;
}

export interface PullRequestText {
  title: string;
  body: string;
}

export function compareUrl(
  repo: RemoteRepo,
  base: string,
  branch: string,
  text: PullRequestText,
): string {
  const query = new URLSearchParams({ expand: '1', title: text.title, body: clipped(text.body) });
  const range = `${encodeURIComponent(base)}...${encodeURIComponent(branch)}`;
  return `https://${repo.host}/${repoSlug(repo)}/compare/${range}?${query.toString()}`;
}

export function pullRequestLink(
  repo: RemoteRepo,
  base: string,
  branch: string,
  text: PullRequestText,
): PrLink | null {
  const kind = linkKind(repo);
  const home = `https://${repo.host}/${repoSlug(repo)}`;
  if (kind === 'github') {
    return { url: compareUrl(repo, base, branch, text), label: 'Create PR on GitHub' };
  }
  if (kind === 'gitlab') {
    const query = new URLSearchParams({
      'merge_request[source_branch]': branch,
      'merge_request[target_branch]': base,
      'merge_request[title]': text.title,
    });
    return {
      url: `${home}/-/merge_requests/new?${query.toString()}`,
      label: 'Create merge request on GitLab',
    };
  }
  if (kind === 'bitbucket') {
    const query = new URLSearchParams({ source: branch, dest: base });
    return {
      url: `${home}/pull-requests/new?${query.toString()}`,
      label: 'Create pull request on Bitbucket',
    };
  }
  return null;
}
