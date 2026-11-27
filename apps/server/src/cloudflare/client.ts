export interface CloudflareClientConfig {
  clientId: string;
  oauthUrl: string;
  apiUrl: string;
  workerFile: string;
}

interface CloudflareEnv {
  SPARK_CLOUDFLARE_CLIENT_ID: string;
  SPARK_SHARE_WORKER_FILE: string;
  CLOUDFLARE_OAUTH_URL?: string | undefined;
  CLOUDFLARE_API_URL?: string | undefined;
}

export const CLOUDFLARE_OAUTH_URL = 'https://dash.cloudflare.com/oauth2';
export const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';

export function cloudflareClientConfig(env: CloudflareEnv): CloudflareClientConfig | null {
  if (!env.SPARK_CLOUDFLARE_CLIENT_ID || !env.SPARK_SHARE_WORKER_FILE) return null;
  return {
    clientId: env.SPARK_CLOUDFLARE_CLIENT_ID,
    oauthUrl: env.CLOUDFLARE_OAUTH_URL ?? CLOUDFLARE_OAUTH_URL,
    apiUrl: env.CLOUDFLARE_API_URL ?? CLOUDFLARE_API_URL,
    workerFile: env.SPARK_SHARE_WORKER_FILE,
  };
}
