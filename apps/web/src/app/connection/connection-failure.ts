import { ApiError } from '../../api/client.ts';

export type FailureKind = 'unreachable' | 'server';

export interface ConnectionFailure {
  kind: FailureKind;
  status: number | null;
  url: string | null;
}

const FIRST_DELAY_MS = 1_000;
const MAX_DELAY_MS = 10_000;
const RESTARTING_STATUSES = new Set([0, 502, 503, 504]);

export function retryDelayMs(failedAttempts: number): number {
  return Math.min(FIRST_DELAY_MS * 2 ** failedAttempts, MAX_DELAY_MS);
}

export function isConnectionLoss(error: unknown): boolean {
  return error instanceof ApiError && RESTARTING_STATUSES.has(error.status);
}

export function describeFailure(error: unknown): ConnectionFailure {
  if (!(error instanceof ApiError)) return { kind: 'server', status: null, url: null };
  return {
    kind: isConnectionLoss(error) ? 'unreachable' : 'server',
    status: error.status === 0 ? null : error.status,
    url: error.url,
  };
}
