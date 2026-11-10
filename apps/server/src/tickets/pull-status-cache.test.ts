import { describe, expect, it, vi } from 'vitest';
import type { PullRequestStatus } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { cachedPullStatus, forgetPullStatuses, PULL_STATUS_TTL_MS } from './pull-status-cache.ts';

const status = (number: number) => ({ number }) as PullRequestStatus;
const open = (): Queryable => ({ query: async () => ({ rows: [] }) }) as unknown as Queryable;

describe('pull request status cache', () => {
  it('shares one read between callers that ask while it is running', async () => {
    const db = open();
    let finish: (value: PullRequestStatus) => void = () => undefined;
    const read = vi.fn(() => new Promise<PullRequestStatus>((resolve) => (finish = resolve)));
    const both = Promise.all([
      cachedPullStatus({ db, now: 0 }, 'a/b#1', read),
      cachedPullStatus({ db, now: 0 }, 'a/b#1', read),
    ]);
    finish(status(1));
    expect(await both).toEqual([status(1), status(1)]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('answers from the cache until it expires', async () => {
    const db = open();
    const read = vi.fn(async () => status(1));
    await cachedPullStatus({ db, now: 0 }, 'a/b#1', read);
    await cachedPullStatus({ db, now: PULL_STATUS_TTL_MS - 1 }, 'a/b#1', read);
    expect(read).toHaveBeenCalledTimes(1);
    await cachedPullStatus({ db, now: PULL_STATUS_TTL_MS }, 'a/b#1', read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed read', async () => {
    const db = open();
    const read = vi.fn(async () => null);
    await cachedPullStatus({ db, now: 0 }, 'a/b#1', read);
    await cachedPullStatus({ db, now: 1 }, 'a/b#1', read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('forgets everything on request and keeps databases apart', async () => {
    const db = open();
    const read = vi.fn(async () => status(1));
    await cachedPullStatus({ db, now: 0 }, 'a/b#1', read);
    await cachedPullStatus({ db: open(), now: 0 }, 'a/b#1', read);
    expect(read).toHaveBeenCalledTimes(2);
    forgetPullStatuses(db);
    await cachedPullStatus({ db, now: 1 }, 'a/b#1', read);
    expect(read).toHaveBeenCalledTimes(3);
  });
});
