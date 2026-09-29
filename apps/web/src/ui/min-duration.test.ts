import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atLeast } from './min-duration.ts';

function settledAfter<T>(promise: Promise<T>) {
  const seen = { done: false };
  promise.then(
    () => (seen.done = true),
    () => (seen.done = true),
  );
  return seen;
}

describe('atLeast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds a fast answer until the minimum time has passed', async () => {
    const result = atLeast(Promise.resolve('ok'), 1200);
    const seen = settledAfter(result);
    await vi.advanceTimersByTimeAsync(1199);
    expect(seen.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('ok');
  });

  it('passes a slow answer through as soon as it arrives', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 3000));
    const result = atLeast(slow, 1200);
    const seen = settledAfter(result);
    await vi.advanceTimersByTimeAsync(2999);
    expect(seen.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('late');
  });

  it('holds a fast failure for the minimum time, then rejects with the same error', async () => {
    const problem = new Error('rejected');
    const result = atLeast(Promise.reject(problem), 1200);
    const seen = settledAfter(result);
    await vi.advanceTimersByTimeAsync(1199);
    expect(seen.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).rejects.toBe(problem);
  });

  it('rejects a slow failure without extra delay', async () => {
    const problem = new Error('timeout');
    const slow = new Promise((_, reject) => setTimeout(() => reject(problem), 2000));
    const result = atLeast(slow, 1200);
    const seen = settledAfter(result);
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.done).toBe(true);
    await expect(result).rejects.toBe(problem);
  });
});
