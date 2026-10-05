import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { API_TOKEN_HEADER, parseSlackCallbackLink } from '@spark-outpost/contracts';
import { gitHubAppEnv, readBakedGitHubApp } from './github-app.ts';

export const SLACK_CLIENT_ID_ENV = 'SPARK_SLACK_CLIENT_ID';

const CLIENT_ID = /^\d{1,20}\.\d{1,20}$/;
const TIMEOUT_MS = 30_000;

export function slackClientId(value: unknown): string | null {
  return typeof value === 'string' && CLIENT_ID.test(value) ? value : null;
}

export async function readBakedSlackClientId(appPath: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(appPath, 'package.json'), 'utf8')) as {
      slackApp?: { clientId?: unknown };
    };
    return slackClientId(manifest.slackApp?.clientId);
  } catch {
    return null;
  }
}

export async function bakedSignInEnv(appPath: string): Promise<Record<string, string>> {
  const slack = await readBakedSlackClientId(appPath);
  return {
    ...gitHubAppEnv(await readBakedGitHubApp(appPath)),
    ...(slack ? { [SLACK_CLIENT_ID_ENV]: slack } : {}),
  };
}

export const isSlackCallback = (url: string, scheme: string): boolean =>
  parseSlackCallbackLink(url, scheme) !== null;

export async function deliverSlackCallback(
  api: { origin: string; token: string },
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${api.origin}/api/slack/sign-in/callback`, {
      method: 'POST',
      headers: { [API_TOKEN_HEADER]: api.token, 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
