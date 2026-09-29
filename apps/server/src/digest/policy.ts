import type { DigestStatus, DigestTrigger } from '@spark-outpost/contracts';

const MINUTE = 60_000;
export const DIGEST_AUTO_AFTER_MS = 30 * MINUTE;
export const MORNING_HOUR = 7;
export const DIGEST_MIN_GAP_MS = 10 * MINUTE;
const DIGEST_DEFAULT_WINDOW_MS = 24 * 60 * MINUTE;
const DIGEST_MAX_WINDOW_MS = 7 * 24 * 60 * MINUTE;

export interface LastDigest {
  status: DigestStatus;
  createdAt: Date;
}

export type DigestDecision = 'start' | 'running' | 'throttled' | 'quiet' | 'fresh';

export function digestSince(lastReadyAt: Date | null, now: Date): Date {
  const earliest = now.getTime() - DIGEST_MAX_WINDOW_MS;
  const start = lastReadyAt ? lastReadyAt.getTime() : now.getTime() - DIGEST_DEFAULT_WINDOW_MS;
  return new Date(Math.max(earliest, start));
}

export function refreshableAt(last: LastDigest | null): Date | null {
  return last ? new Date(last.createdAt.getTime() + DIGEST_MIN_GAP_MS) : null;
}

export type BriefTrigger = DigestTrigger | 'morning';

export function morningDue(last: LastDigest | null, now: Date): boolean {
  const morning = new Date(now);
  morning.setHours(MORNING_HOUR, 0, 0, 0);
  if (now < morning) return false;
  return !last || last.createdAt < morning;
}

export function decideDigest(
  trigger: BriefTrigger,
  last: LastDigest | null,
  changed: boolean,
  now: Date,
  autoAfterMs: number | null = DIGEST_AUTO_AFTER_MS,
): DigestDecision {
  if (last?.status === 'running') return 'running';
  const age = last ? now.getTime() - last.createdAt.getTime() : Infinity;
  if (age < DIGEST_MIN_GAP_MS) return 'throttled';
  if (!changed) return 'quiet';
  if (trigger === 'morning') return morningDue(last, now) ? 'start' : 'fresh';
  if (trigger === 'open' && (autoAfterMs === null || age < autoAfterMs)) return 'fresh';
  return 'start';
}
