import { describe, expect, it } from 'vitest';
import type { TicketSummary } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import {
  backoffUntil,
  forgetSource,
  lastGoodRead,
  recordGoodRead,
  startBackoff,
} from './source-backoff.ts';

const db = (): Queryable => ({ query: async () => ({ rows: [] }) }) as unknown as Queryable;
const T0 = new Date('2026-03-02T09:00:00Z');
const after = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const good = { tickets: [{ key: 'API-1' } as TicketSummary], truncated: false };

describe('source backoff', () => {
  it('holds until its time, then lets the source through', () => {
    const store = db();
    startBackoff(store, 'w1', 'jira', { until: after(30).getTime(), status: 429 });
    expect(backoffUntil(store, 'w1', 'jira', after(29))).toEqual({
      until: after(30).getTime(),
      status: 429,
    });
    expect(backoffUntil(store, 'w1', 'jira', after(30))).toBeNull();
  });

  it('keeps each source and workspace apart', () => {
    const store = db();
    startBackoff(store, 'w1', 'jira', { until: after(30).getTime(), status: 429 });
    expect(backoffUntil(store, 'w1', 'linear', T0)).toBeNull();
    expect(backoffUntil(store, 'w2', 'jira', T0)).toBeNull();
    expect(backoffUntil(db(), 'w1', 'jira', T0)).toBeNull();
  });

  it('clears the wait on a good read and keeps what it read', () => {
    const store = db();
    startBackoff(store, 'w1', 'jira', { until: after(30).getTime(), status: 429 });
    recordGoodRead(store, 'w1', 'jira', good);
    expect(backoffUntil(store, 'w1', 'jira', T0)).toBeNull();
    expect(lastGoodRead(store, 'w1', 'jira')).toBe(good);
  });

  it('forgets a source that was reconnected', () => {
    const store = db();
    recordGoodRead(store, 'w1', 'jira', good);
    startBackoff(store, 'w1', 'jira', { until: after(30).getTime(), status: 503 });
    forgetSource(store, 'w1', 'jira');
    expect(backoffUntil(store, 'w1', 'jira', T0)).toBeNull();
    expect(lastGoodRead(store, 'w1', 'jira')).toBeNull();
  });
});
