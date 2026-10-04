export const GITHUB_APP_HOST = 'github.com';
export const GITHUB_LOGIN_URL = 'https://github.com';

export interface GitHubAppConfig {
  clientId: string;
  slug: string;
  loginUrl: string;
}

interface AppEnv {
  SPARK_GITHUB_APP_CLIENT_ID: string;
  SPARK_GITHUB_APP_SLUG: string;
  GITHUB_LOGIN_URL?: string | undefined;
}

export function gitHubAppConfig(env: AppEnv): GitHubAppConfig | null {
  if (!env.SPARK_GITHUB_APP_CLIENT_ID) return null;
  return {
    clientId: env.SPARK_GITHUB_APP_CLIENT_ID,
    slug: env.SPARK_GITHUB_APP_SLUG,
    loginUrl: env.GITHUB_LOGIN_URL ?? GITHUB_LOGIN_URL,
  };
}

export function installUrl(app: GitHubAppConfig): string | null {
  return app.slug ? `https://github.com/apps/${app.slug}/installations/new` : null;
}
