import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';

export const HEARTBEAT_URL_ENV = 'SPARK_HEARTBEAT_URL';
export const FIRST_HEARTBEAT_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface Heartbeat {
  installId: string;
  version: string;
  os: string;
  arch: string;
  channel: string;
}

export function heartbeatUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '' || !URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  if (url.username || url.password) return null;
  if (url.protocol === 'https:') return url.href;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url.href;
  return null;
}

export async function readBakedHeartbeatUrl(appPath: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(path.join(appPath, 'package.json'), 'utf8')) as {
      heartbeatUrl?: unknown;
    };
    return typeof manifest.heartbeatUrl === 'string' ? heartbeatUrl(manifest.heartbeatUrl) : null;
  } catch {
    return null;
  }
}

export function installIdFile(userData: string): string {
  return path.join(userData, 'install-id');
}

export async function loadInstallId(file: string): Promise<string> {
  const saved = (await readFile(file, 'utf8').catch(() => '')).trim();
  if (UUID_V4.test(saved)) return saved;
  const created = randomUUID();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${created}\n`, { mode: 0o600 });
  await rename(temporary, file);
  return created;
}

export async function heartbeatEnabled(
  origin: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${origin}/api/setup`, {
      headers: { [API_TOKEN_HEADER]: token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { profile?: { heartbeat?: unknown } };
    return body.profile?.heartbeat === true;
  } catch {
    return false;
  }
}

export async function sendHeartbeat(
  url: string,
  heartbeat: Heartbeat,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(heartbeat),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface HeartbeatOptions {
  url: string | null;
  enabled: () => Promise<boolean>;
  heartbeat: () => Promise<Heartbeat>;
  send?: (url: string, heartbeat: Heartbeat) => Promise<boolean>;
}

export interface HeartbeatTimer {
  dispose: () => void;
}

export function startHeartbeat(options: HeartbeatOptions): HeartbeatTimer {
  const { url } = options;
  if (!url) return { dispose: () => undefined };
  const send = options.send ?? sendHeartbeat;
  const attempt = async () => {
    if (await options.enabled()) await send(url, await options.heartbeat());
  };
  const beat = () => void attempt().catch(() => undefined);
  let interval: NodeJS.Timeout | null = null;
  const first = setTimeout(() => {
    beat();
    interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    interval.unref();
  }, FIRST_HEARTBEAT_MS);
  first.unref();
  return {
    dispose: () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}
