import { z } from 'zod';
import type { GitHubRepoAccess, GitHubTokenInfo } from '@spark-outpost/contracts';
import { repoSlug } from '../remote.ts';
import { GitHubApiError, restConnection, type GitHubRequest, type RepoRef } from './connection.ts';

export const REPO_CHECK_LIMIT = 10;

const permissionsSchema = z.object({
  permissions: z.object({ push: z.boolean().optional(), pull: z.boolean().optional() }).optional(),
});

const EXPIRY = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/;

export function parseExpiry(header: string | null): string | null {
  const match = EXPIRY.exec(header?.trim() ?? '');
  if (!match) return null;
  const [, day, time, zone] = match as unknown as [string, string, string, string];
  const offset = zone === 'UTC' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const parsed = Date.parse(`${day}T${time}${offset}`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function parseScopes(header: string | null): string[] {
  return (header ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function repoAccess(request: GitHubRequest, repo: RepoRef): Promise<GitHubRepoAccess> {
  const answer = await request(
    'GET',
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
  );
  if (answer.status !== 200) return { repo: repoSlug(repo), access: 'none' };
  const permissions = permissionsSchema.safeParse(answer.data);
  const push = permissions.success && permissions.data.permissions?.push === true;
  return { repo: repoSlug(repo), access: push ? 'push' : 'read' };
}

export async function validateToken(
  host: string,
  request: GitHubRequest,
  repos: readonly RepoRef[],
): Promise<Omit<GitHubTokenInfo, 'validatedAt'>> {
  const user = await request('GET', '/user');
  if (user.status === 401) {
    throw new GitHubApiError(
      401,
      "GitHub rejected this token (401). Check that it's active and copied in full.",
    );
  }
  const { login } = await restConnection('token', host, async () => user).whoami();
  const access = [];
  for (const repo of repos.slice(0, REPO_CHECK_LIMIT)) access.push(await repoAccess(request, repo));
  return {
    host,
    login,
    scopes: parseScopes(user.header('x-oauth-scopes')),
    expiresAt: parseExpiry(user.header('github-authentication-token-expiration')),
    repos: access,
  };
}
