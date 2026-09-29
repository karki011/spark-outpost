import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atLeast } from './at-least.ts';

describe('atLeast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits out the minimum when the work is quick', async () => {
    let done = false;
    const result = atLeast(Promise.resolve('found'), 600).then((value) => {
      done = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(599);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('found');
  });

  it('adds nothing when the work is slower than the minimum', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 900));
    const result = atLeast(slow, 600);
    await vi.advanceTimersByTimeAsync(900);
    await expect(result).resolves.toBe('late');
  });

  it('fails as soon as the work fails', async () => {
    const result = atLeast(Promise.reject(new Error('nope')), 600);
    await expect(result).rejects.toThrow('nope');
  });
});
