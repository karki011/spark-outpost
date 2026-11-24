export const CLOUD_POLL_MS = 3 * 60_000;
export const CLOUD_BACKOFF_START_MS = 30_000;
export const CLOUD_BACKOFF_MAX_MS = 30 * 60_000;
export const TOKEN_MARGIN_MS = 60_000;
export const RANGE_CONCURRENCY = 4;

export function backoffMs(failures: number, retryAfterMs: number | null, random: number): number {
  const base = Math.min(CLOUD_BACKOFF_MAX_MS, CLOUD_BACKOFF_START_MS * 2 ** (failures - 1));
  const jittered = Math.round(base * (0.8 + random * 0.4));
  return Math.max(jittered, retryAfterMs ?? 0);
}

export async function settleAll<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>,
  limit = RANGE_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += limit) {
    results.push(...(await Promise.allSettled(items.slice(index, index + limit).map(work))));
  }
  return results;
}

export interface PollOutcome {
  changed: boolean;
  nextInMs: number | null;
}
