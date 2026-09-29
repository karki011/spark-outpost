import { describe, expect, it } from 'vitest';
import { createLimiter } from './scanner.ts';

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
