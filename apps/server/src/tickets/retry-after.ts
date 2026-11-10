export const DEFAULT_BACKOFF_MS = 60_000;
export const MIN_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 10 * 60_000;

const SECONDS = /^\d{1,9}$/;

export function parseRetryAfter(value: string | null | undefined, now: Date): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (SECONDS.test(text)) return Number(text) * 1000;
  if (!/[a-z]/i.test(text)) return null;
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : date - now.getTime();
}

export function backoffMs(value: string | null | undefined, now: Date): number {
  const asked = parseRetryAfter(value, now);
  return Math.min(Math.max(asked ?? DEFAULT_BACKOFF_MS, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
}
