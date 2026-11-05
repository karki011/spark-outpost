import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const GITHUB_APP_CLIENT_ID_ENV = 'SPARK_GITHUB_APP_CLIENT_ID';
export const GITHUB_APP_SLUG_ENV = 'SPARK_GITHUB_APP_SLUG';

export interface GitHubAppIds {
  clientId: string;
  slug: string;
}

const CLIENT_ID = /^[A-Za-z0-9.]{1,64}$/;
const SLUG = /^[A-Za-z0-9-]{0,64}$/;

export function gitHubAppIds(clientId: unknown, slug: unknown): GitHubAppIds | null {
  if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) return null;
  return { clientId, slug: typeof slug === 'string' && SLUG.test(slug) ? slug : '' };
}

export async function readBakedGitHubApp(appPath: string): Promise<GitHubAppIds | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(appPath, 'package.json'), 'utf8')) as {
      githubApp?: { clientId?: unknown; slug?: unknown };
    };
    return gitHubAppIds(manifest.githubApp?.clientId, manifest.githubApp?.slug);
  } catch {
    return null;
  }
}

export function gitHubAppEnv(ids: GitHubAppIds | null): Record<string, string> {
  if (!ids) return {};
  return { [GITHUB_APP_CLIENT_ID_ENV]: ids.clientId, [GITHUB_APP_SLUG_ENV]: ids.slug };
}
