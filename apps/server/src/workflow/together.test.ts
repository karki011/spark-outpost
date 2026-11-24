import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fulfilled, together } from './together.ts';

const unhandled: unknown[] = [];
const noteUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', noteUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', noteUnhandled);
});

const after = <Value>(ms: number, value: Value) => delay(ms).then(() => value);
const failing = (ms: number, message: string) =>
  delay(ms).then(() => {
    throw new Error(message);
  });

describe('together', () => {
  it('runs the work at once and keeps each value in its place', async () => {
    const started = Date.now();
    const [slow, plain, fast] = await together([after(40, 'slow'), 7, after(1, 'fast')]);
    expect([slow, plain, fast]).toEqual(['slow', 7, 'fast']);
    expect(Date.now() - started).toBeLessThan(75);
  });

  it('fails with the earliest listed failure, whichever happened first', async () => {
    await expect(
      together([after(1, 'ok'), failing(30, 'listed first'), failing(1, 'listed second')]),
    ).rejects.toThrow('listed first');
  });

  it('waits for every branch before failing and leaves no rejection unhandled', async () => {
    let finished = false;
    const slow = delay(30).then(() => {
      finished = true;
    });
    await expect(together([failing(1, 'early'), slow, failing(40, 'late')])).rejects.toThrow(
      'early',
    );
    expect(finished).toBe(true);
    await delay(10);
    expect(unhandled).toEqual([]);
  });
});

describe('fulfilled', () => {
  it('returns the values of work that was settled ahead of time', async () => {
    const settled = await Promise.allSettled([after(1, 'a'), after(1, 2)] as const);
    expect(fulfilled(settled)).toEqual(['a', 2]);
  });

  it('throws the earliest listed failure of work settled ahead of time', async () => {
    const settled = await Promise.allSettled([after(1, 'a'), failing(5, 'one'), failing(1, 'two')]);
    expect(() => fulfilled(settled)).toThrow('one');
    await delay(10);
    expect(unhandled).toEqual([]);
  });
});
