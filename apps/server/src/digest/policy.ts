import {
  DEFAULT_MORNING_BRIEF_TIME,
  type DigestStatus,
  type DigestTrigger,
} from '@spark-outpost/contracts';

const MINUTE = 60_000;
export const DIGEST_AUTO_AFTER_MS = 30 * MINUTE;
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

export function morningDue(
  last: LastDigest | null,
  now: Date,
  time = DEFAULT_MORNING_BRIEF_TIME,
): boolean {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const morning = new Date(now);
  morning.setHours(hour, minute, 0, 0);
  if (now < morning) return false;
  return !last || last.createdAt < morning;
}

export function decideDigest(
  trigger: BriefTrigger,
  last: LastDigest | null,
  changed: boolean,
  now: Date,
  autoAfterMs: number | null = DIGEST_AUTO_AFTER_MS,
  morningTime = DEFAULT_MORNING_BRIEF_TIME,
): DigestDecision {
  if (last?.status === 'running') return 'running';
  const age = last ? now.getTime() - last.createdAt.getTime() : Infinity;
  if (age < DIGEST_MIN_GAP_MS) return 'throttled';
  if (!changed) return 'quiet';
  if (trigger === 'morning') return morningDue(last, now, morningTime) ? 'start' : 'fresh';
  if (trigger === 'open' && (autoAfterMs === null || age < autoAfterMs)) return 'fresh';
  return 'start';
}
