import type { Session } from 'electron';
import { REMOTE_DEVICE_COOKIE, remoteSparkOrigin } from '@spark-outpost/contracts';

export const REMOTE_SPARK_END_TIMEOUT_MS = 5_000;

export async function endRemoteSession(target: Session, hostname: string): Promise<void> {
  const origin = remoteSparkOrigin(hostname);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REMOTE_SPARK_END_TIMEOUT_MS);
  try {
    const held = await target.cookies.get({ url: origin, name: REMOTE_DEVICE_COOKIE });
    if (held.length === 0) return;
    await target.fetch(`${origin}/api/remote/session/end`, {
      method: 'POST',
      credentials: 'include',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
      signal: abort.signal,
    });
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
  }
}
