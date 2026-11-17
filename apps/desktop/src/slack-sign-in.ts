import { readFile } from 'node:fs/promises';
import { API_TOKEN_HEADER, parseSlackCallbackLink } from '@spark-outpost/contracts';
import { readBakedManifest, type BakedManifest } from './baked-manifest.ts';

export const SLACK_CLIENT_ID_ENV = 'SPARK_SLACK_CLIENT_ID';
export const SLACK_CLIENT_ID_FILE_NAME = 'slack-client-id';

const CLIENT_ID = /^\d{1,20}\.\d{1,20}$/;
const TIMEOUT_MS = 30_000;

export function slackClientId(value: unknown): string | null {
  return typeof value === 'string' && CLIENT_ID.test(value) ? value : null;
}

export function slackClientIdFromManifest(manifest: BakedManifest | null): string | null {
  const slackApp = manifest?.slackApp as { clientId?: unknown } | null | undefined;
  return slackClientId(slackApp?.clientId);
}

export async function readBakedSlackClientId(appPath: string): Promise<string | null> {
  return slackClientIdFromManifest(await readBakedManifest(appPath));
}

export async function readDevSlackClientId(file: string | null): Promise<string | null> {
  if (!file) return null;
  try {
    return slackClientId((await readFile(file, 'utf8')).trim());
  } catch {
    return null;
  }
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
