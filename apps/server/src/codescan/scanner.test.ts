import { describe, expect, it } from 'vitest';
import { createLimiter } from './scanner.ts';
import { spellings, undefinedTerms } from './scan.ts';
import { STATUS_TTL_MS, statusIsFresh } from './status-cache.ts';

describe('createLimiter', () => {
  it('runs two at once and queues the rest in order', async () => {
    const limiter = createLimiter(2);
    const signal = new AbortController().signal;
    expect(await limiter.acquire(signal)).toBe(true);
    expect(await limiter.acquire(signal)).toBe(true);
    const order: string[] = [];
    const third = limiter.acquire(signal).then(() => order.push('third'));
    const fourth = limiter.acquire(signal).then(() => order.push('fourth'));
    await Promise.resolve();
    expect(order).toEqual([]);
    limiter.release();
    await third;
    limiter.release();
    await fourth;
    expect(order).toEqual(['third', 'fourth']);
  });

  it('gives up a queued slot when the deadline passes', async () => {
    const limiter = createLimiter(1);
    const deadline = new AbortController();
    await limiter.acquire(new AbortController().signal);
    const waiting = limiter.acquire(deadline.signal);
    deadline.abort();
    expect(await waiting).toBe(false);
    limiter.release();
    expect(await limiter.acquire(new AbortController().signal)).toBe(true);
  });
});

describe('statusIsFresh', () => {
  const entry = { at: 1000, indexMtime: 5, changes: Promise.resolve([]) };

  it('reuses git status for a few seconds while the git index is unchanged', () => {
    expect(statusIsFresh(entry, 1000 + STATUS_TTL_MS - 1, 5)).toBe(true);
    expect(statusIsFresh(entry, 1000 + STATUS_TTL_MS, 5)).toBe(false);
    expect(statusIsFresh(entry, 1001, 6)).toBe(false);
    expect(statusIsFresh(undefined, 1001, 5)).toBe(false);
  });
});

describe('undefinedTerms', () => {
  it('keeps request names that no file defines under any spelling', () => {
    const named = new Map([
      ['useChartData', 1],
      ['SearchInput', 2],
      ['DatePicker', 3],
      ['nowhere', 4],
    ]);
    const stats = new Map([
      [1, { defFiles: 1, refFiles: 4 }],
      [2, { defFiles: 0, refFiles: 9 }],
      [3, { defFiles: 2, refFiles: 9 }],
      [4, { defFiles: 1, refFiles: 1 }],
    ]);
    expect(
      undefinedTerms(
        ['useChartData', 'SearchInput', 'date-picker', 'Nowhere', 'abc'],
        named,
        stats,
      ),
    ).toEqual(['SearchInput', 'Nowhere']);
  });
});

describe('spellings', () => {
  it('looks up code-shaped names as written and expands kebab and snake names', () => {
    expect(spellings('SearchInput')).toEqual(['SearchInput']);
    expect(spellings('date-picker')).toContain('DatePicker');
  });
});
