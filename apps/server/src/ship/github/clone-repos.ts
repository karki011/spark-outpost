import { z } from 'zod';
import type { CloneOptions, CloneRepo } from '@spark-outpost/contracts';
import { accountConnection, connectedAppRepos, type GitHubDeps } from './access.ts';
import { GITHUB_APP_HOST } from './app-config.ts';
import { GitHubApiError } from './connection.ts';

const PAGE_SIZE = 100;
const PAGES = 3;
const SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const reposSchema = z.array(z.object({ full_name: z.string().regex(SLUG) }));

export type CloneRepoList = Pick<CloneOptions, 'connected' | 'repos' | 'truncated' | 'listError'>;

const NOT_CONNECTED: CloneRepoList = {
  connected: false,
  repos: [],
  truncated: false,
  listError: null,
};

const repoOn = (host: string, slug: string): CloneRepo => ({
  slug,
  url: `https://${host}/${slug}.git`,
});

export async function cloneableRepos(deps: GitHubDeps): Promise<CloneRepoList> {
  const app = await connectedAppRepos(deps);
  if (app) {
    return {
      connected: true,
      repos: app.repos
        .filter((slug) => SLUG.test(slug))
        .map((slug) => repoOn(GITHUB_APP_HOST, slug)),
      truncated: app.truncated,
      listError: null,
    };
  }
  const account = await accountConnection(deps);
  if (!account) return NOT_CONNECTED;
  const repos: CloneRepo[] = [];
  try {
    for (let page = 1; page <= PAGES; page += 1) {
      const found = await account.get(
        `/user/repos?per_page=${PAGE_SIZE}&sort=pushed&page=${page}`,
        reposSchema,
        'listing your repositories',
      );
      repos.push(...found.map((repo) => repoOn(account.host, repo.full_name)));
      if (found.length < PAGE_SIZE)
        return { connected: true, repos, truncated: false, listError: null };
    }
  } catch (error) {
    if (!(error instanceof GitHubApiError)) throw error;
    return { connected: true, repos, truncated: false, listError: error.message };
  }
  return { connected: true, repos, truncated: true, listError: null };
}
