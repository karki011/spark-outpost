import { readBakedManifest, type BakedManifest } from './baked-manifest.ts';

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

export function gitHubAppFromManifest(manifest: BakedManifest | null): GitHubAppIds | null {
  const githubApp = manifest?.githubApp as
    { clientId?: unknown; slug?: unknown } | null | undefined;
  return gitHubAppIds(githubApp?.clientId, githubApp?.slug);
}

export async function readBakedGitHubApp(appPath: string): Promise<GitHubAppIds | null> {
  return gitHubAppFromManifest(await readBakedManifest(appPath));
}

export function gitHubAppEnv(ids: GitHubAppIds | null): Record<string, string> {
  if (!ids) return {};
  return { [GITHUB_APP_CLIENT_ID_ENV]: ids.clientId, [GITHUB_APP_SLUG_ENV]: ids.slug };
}
