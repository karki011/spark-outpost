import type { TicketSourceId } from '@spark-outpost/contracts';
import { ApiError } from '../api/client.ts';

export type ConnectField = 'siteUrl' | 'email' | 'apiToken' | 'apiKey';

export type CheckMood = 'checking' | 'happy' | 'sad' | 'puzzled' | 'neutral';

export interface CheckFailure {
  message: string;
  field: ConnectField | null;
  mood: CheckMood;
}

export const MIN_CHECK_MS = 1200;
export const CELEBRATE_MS = 1000;

export const secretField = (source: TicketSourceId): ConnectField =>
  source === 'jira' ? 'apiToken' : 'apiKey';

const REJECTED = 400;
const UNREACHABLE = 502;

export function checkFailure(source: TicketSourceId, error: unknown): CheckFailure {
  const message = error instanceof Error ? error.message : 'Something went wrong. Try again.';
  if (!(error instanceof ApiError)) return { message, field: null, mood: 'neutral' };
  if (error.status === REJECTED) return { message, field: secretField(source), mood: 'sad' };
  if (error.status === UNREACHABLE) {
    return { message, field: source === 'jira' ? 'siteUrl' : null, mood: 'puzzled' };
  }
  return { message, field: null, mood: 'neutral' };
}
