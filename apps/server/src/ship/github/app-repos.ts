import { z } from 'zod';
import type { RepoList } from '../../persistence/github-app.ts';
import { repoSlug, type RemoteRepo } from '../remote.ts';
import { GITHUB_APP_HOST } from './app-config.ts';
import { restConnection, type GitHubRequest } from './connection.ts';

const PAGE_SIZE = 100;
export const APP_REPO_LIMIT = 1000;

const installationsSchema = z.object({
  installations: z.array(z.object({ id: z.number().int().positive() })),
});

const repositoriesSchema = z.object({
  repositories: z.array(
    z.object({ full_name: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/) }),
  ),
});

export async function reachableRepos(request: GitHubRequest): Promise<RepoList> {
  const github = restConnection('app', GITHUB_APP_HOST, request);
  const { installations } = await github.get(
    `/user/installations?per_page=${PAGE_SIZE}`,
    installationsSchema,
    'listing where the app is installed',
  );
  const repos = new Set<string>();
  let truncated = installations.length === PAGE_SIZE;
  for (const installation of installations) {
    for (let page = 1; ; page += 1) {
      if (repos.size >= APP_REPO_LIMIT) {
        truncated = true;
        break;
      }
      const { repositories } = await github.get(
        `/user/installations/${installation.id}/repositories?per_page=${PAGE_SIZE}&page=${page}`,
        repositoriesSchema,
        'listing the repositories the app can reach',
      );
      for (const repo of repositories) repos.add(repo.full_name);
      if (repositories.length < PAGE_SIZE) break;
    }
  }
  return { repos: [...repos].slice(0, APP_REPO_LIMIT).sort(), truncated };
}

export function coversRepo(repos: readonly string[], repo: RemoteRepo): boolean {
  if (repo.host !== GITHUB_APP_HOST) return false;
  const slug = repoSlug(repo).toLowerCase();
  return repos.some((entry) => entry.toLowerCase() === slug);
}
