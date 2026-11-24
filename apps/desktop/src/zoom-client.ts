import { readFile } from 'node:fs/promises';
import type { BakedManifest } from './baked-manifest.ts';

export const ZOOM_CLIENT_ID_ENV = 'SPARK_ZOOM_CLIENT_ID';
export const ZOOM_CLIENT_FILE_NAME = 'zoom-oauth-client.json';

const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function zoomClientId(value: unknown): string | null {
  const fields = value as { client_id?: unknown } | null;
  const clientId = typeof fields?.client_id === 'string' ? fields.client_id.trim() : '';
  return CLIENT_ID.test(clientId) ? clientId : null;
}

export function zoomClientFromFile(text: string): string | null {
  try {
    return zoomClientId(JSON.parse(text));
  } catch {
    return null;
  }
}

export function zoomClientEnv(clientId: string | null): Record<string, string> {
  return clientId ? { [ZOOM_CLIENT_ID_ENV]: clientId } : {};
}

export function zoomClientFromManifest(manifest: BakedManifest | null): string | null {
  return zoomClientId(manifest?.zoomApp ?? null);
}

export async function readDevZoomClient(file: string | null): Promise<string | null> {
  if (!file) return null;
  try {
    return zoomClientFromFile(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
