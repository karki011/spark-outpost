import type { ServiceNowAuthKind, TicketSourceId } from '@spark-outpost/contracts';
import { ApiError } from '../api/client.ts';

export type ConnectField =
  'siteUrl' | 'email' | 'apiToken' | 'apiKey' | 'instanceUrl' | 'username' | 'password';

export type CheckMood = 'checking' | 'happy' | 'sad' | 'puzzled' | 'neutral';

export interface CheckFailure {
  message: string;
  field: ConnectField | null;
  mood: CheckMood;
}

export const MIN_CHECK_MS = 1200;
export const CELEBRATE_MS = 1000;

export function secretField(source: TicketSourceId, authKind: ServiceNowAuthKind): ConnectField {
  if (source === 'jira') return 'apiToken';
  return source === 'servicenow' && authKind === 'basic' ? 'password' : 'apiKey';
}

const SITE_FIELD: Record<TicketSourceId, ConnectField | null> = {
  jira: 'siteUrl',
  linear: null,
  servicenow: 'instanceUrl',
};

const REJECTED = 400;
const UNREACHABLE = 502;

export function checkFailure(
  source: TicketSourceId,
  error: unknown,
  authKind: ServiceNowAuthKind = 'basic',
): CheckFailure {
  const message = error instanceof Error ? error.message : 'Something went wrong. Try again.';
  if (!(error instanceof ApiError)) return { message, field: null, mood: 'neutral' };
  if (error.status === REJECTED) {
    return { message, field: secretField(source, authKind), mood: 'sad' };
  }
  if (error.status === UNREACHABLE) return { message, field: SITE_FIELD[source], mood: 'puzzled' };
  return { message, field: null, mood: 'neutral' };
}
