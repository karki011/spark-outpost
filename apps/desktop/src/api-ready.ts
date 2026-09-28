import { setTimeout as delay } from 'node:timers/promises';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';

const POLL_MS = 250;

export async function waitForApi(
  origin: string,
  token: string,
  signal: AbortSignal,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(`${origin}/api/health`, {
        headers: { [API_TOKEN_HEADER]: token },
        signal,
      });
      if (response.ok) return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await delay(POLL_MS);
  }
  throw new Error(`The API did not answer within ${timeoutMs / 1000} seconds.`);
}
