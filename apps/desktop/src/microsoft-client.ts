import { readFile } from 'node:fs/promises';
import type { BakedManifest } from './baked-manifest.ts';

export const MICROSOFT_CLIENT_ID_ENV = 'SPARK_MICROSOFT_CLIENT_ID';
export const MICROSOFT_CLIENT_FILE_NAME = 'microsoft-oauth-client.json';

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function microsoftClientId(value: unknown): string | null {
  const fields = value as { client_id?: unknown } | null;
  const clientId = typeof fields?.client_id === 'string' ? fields.client_id.trim() : '';
  return CLIENT_ID.test(clientId) ? clientId : null;
}

export function microsoftClientFromFile(text: string): string | null {
  try {
    return microsoftClientId(JSON.parse(text));
  } catch {
    return null;
  }
}

export function microsoftClientEnv(clientId: string | null): Record<string, string> {
  return clientId ? { [MICROSOFT_CLIENT_ID_ENV]: clientId } : {};
}

export function microsoftClientFromManifest(manifest: BakedManifest | null): string | null {
  return microsoftClientId(manifest?.microsoftApp ?? null);
}

export async function readDevMicrosoftClient(file: string | null): Promise<string | null> {
  if (!file) return null;
  try {
    return microsoftClientFromFile(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
