import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { oneAtATimeWhenIdle } from './when-idle.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('oneAtATimeWhenIdle', () => {
  it('runs the tasks in order, one per idle period, and waits for each to finish', async () => {
    const order: string[] = [];
    let finishFirst: () => void = () => undefined;
    oneAtATimeWhenIdle([
      () => {
        order.push('first started');
        return new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
      },
      () => order.push('second'),
      () => Promise.reject(new Error('offline')),
      () => order.push('fourth'),
    ]);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(order).toEqual(['first started']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(order).toEqual(['first started']);
    finishFirst();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(order).toEqual(['first started', 'second']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(order).toEqual(['first started', 'second', 'fourth']);
  });

  it('waits the given time before the first task', async () => {
    const order: string[] = [];
    oneAtATimeWhenIdle([() => order.push('first')], 3_000);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_501);
    expect(order).toEqual(['first']);
  });

  it('stops when cancelled', async () => {
    const order: string[] = [];
    const cancel = oneAtATimeWhenIdle([() => order.push('first'), () => order.push('second')]);
    await vi.advanceTimersByTimeAsync(1_500);
    cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(order).toEqual(['first']);
  });
});
