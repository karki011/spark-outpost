import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const GOOGLE_CLIENT_ID_ENV = 'SPARK_GOOGLE_CLIENT_ID';
export const GOOGLE_CLIENT_SECRET_ENV = 'SPARK_GOOGLE_CLIENT_SECRET';
export const GOOGLE_VERIFIED_ENV = 'SPARK_GOOGLE_VERIFIED';
export const GOOGLE_CLIENT_FILE_NAME = 'google-oauth-client.json';

const CLIENT_ID = /^\d{1,30}-[a-z0-9]{1,64}\.apps\.googleusercontent\.com$/;
const CLIENT_SECRET = /^[A-Za-z0-9_-]{1,100}$/;

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  verified: boolean;
}

export function googleClient(value: unknown, verified = false): GoogleClient | null {
  const fields = value as { client_id?: unknown; client_secret?: unknown } | null;
  const clientId = typeof fields?.client_id === 'string' ? fields.client_id.trim() : '';
  const clientSecret = typeof fields?.client_secret === 'string' ? fields.client_secret.trim() : '';
  if (!CLIENT_ID.test(clientId) || !CLIENT_SECRET.test(clientSecret)) return null;
  return { clientId, clientSecret, verified };
}

export function googleClientFromDownload(text: string): GoogleClient | null {
  try {
    const parsed = JSON.parse(text) as { installed?: unknown };
    return googleClient(parsed.installed ?? null);
  } catch {
    return null;
  }
}

export function googleClientEnv(client: GoogleClient | null): Record<string, string> {
  if (!client) return {};
  return {
    [GOOGLE_CLIENT_ID_ENV]: client.clientId,
    [GOOGLE_CLIENT_SECRET_ENV]: client.clientSecret,
    [GOOGLE_VERIFIED_ENV]: client.verified ? 'true' : 'false',
  };
}

export async function readBakedGoogleClient(appPath: string): Promise<GoogleClient | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(appPath, 'package.json'), 'utf8')) as {
      googleApp?: { client_id?: unknown; client_secret?: unknown; verified?: unknown };
    };
    return googleClient(manifest.googleApp ?? null, manifest.googleApp?.verified === true);
  } catch {
    return null;
  }
}

export async function readDevGoogleClient(file: string | null): Promise<GoogleClient | null> {
  if (!file) return null;
  try {
    return googleClientFromDownload(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
