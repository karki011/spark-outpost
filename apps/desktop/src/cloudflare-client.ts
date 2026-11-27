import { access, readFile } from 'node:fs/promises';
import type { BakedManifest } from './baked-manifest.ts';

export const CLOUDFLARE_CLIENT_ID_ENV = 'SPARK_CLOUDFLARE_CLIENT_ID';
export const SHARE_WORKER_FILE_ENV = 'SPARK_SHARE_WORKER_FILE';
export const CLOUDFLARE_CLIENT_FILE_NAME = 'cloudflare-oauth-client.json';
export const SHARE_WORKER_FILE = 'dist/share-worker.mjs';

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

function cloudflareClientId(value: unknown): string | null {
  const fields = value as { client_id?: unknown } | null;
  const clientId = typeof fields?.client_id === 'string' ? fields.client_id.trim() : '';
  return CLIENT_ID.test(clientId) ? clientId : null;
}

export function cloudflareClientFromFile(text: string): string | null {
  try {
    return cloudflareClientId(JSON.parse(text));
  } catch {
    return null;
  }
}

export function cloudflareClientFromManifest(manifest: BakedManifest | null): string | null {
  return cloudflareClientId(manifest?.cloudflareApp ?? null);
}

export async function readDevCloudflareClient(file: string | null): Promise<string | null> {
  if (!file) return null;
  try {
    return cloudflareClientFromFile(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function cloudflareClientEnv(
  clientId: string | null,
  workerFile: string | null,
): Promise<Record<string, string>> {
  if (!clientId || !workerFile) return {};
  try {
    await access(workerFile);
  } catch {
    return {};
  }
  return { [CLOUDFLARE_CLIENT_ID_ENV]: clientId, [SHARE_WORKER_FILE_ENV]: workerFile };
}
