import type { DigestStatus, DigestTrigger } from '@spark-outpost/contracts';

const MINUTE = 60_000;
const DIGEST_AUTO_AFTER_MS = 60 * MINUTE;
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

export function decideDigest(
  trigger: DigestTrigger,
  last: LastDigest | null,
  newActivity: boolean,
  now: Date,
): DigestDecision {
  if (last?.status === 'running') return 'running';
  const age = last ? now.getTime() - last.createdAt.getTime() : Infinity;
  if (age < DIGEST_MIN_GAP_MS) return 'throttled';
  if (!newActivity) return 'quiet';
  if (trigger === 'open' && age < DIGEST_AUTO_AFTER_MS) return 'fresh';
  return 'start';
}
