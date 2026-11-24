import { describe, expect, it } from 'vitest';
import { bounded } from './bounded.ts';

function gate() {
  let open: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, closed };
}

describe('bounded', () => {
  it('returns results in task order', async () => {
    const [first, second, third] = await bounded(2, [
      () => new Promise<string>((resolve) => setTimeout(() => resolve('slow'), 5)),
      () => Promise.resolve(2),
      () => Promise.resolve(true),
    ]);
    expect([first, second, third]).toEqual(['slow', 2, true]);
  });

  it('never runs more tasks at once than the limit', async () => {
    let running = 0;
    let most = 0;
    const task = async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
    };
    await bounded(
      3,
      Array.from({ length: 10 }, () => task),
    );
    expect(most).toBe(3);
  });

  it('starts the next task as soon as one finishes', async () => {
    const first = gate();
    const started: number[] = [];
    const all = bounded(2, [
      async () => {
        started.push(0);
        await first.closed;
      },
      () => Promise.resolve(started.push(1)),
      () => Promise.resolve(started.push(2)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(started).toEqual([0, 1, 2]);
    first.open();
    await all;
  });

  it('rejects when a task fails and starts no further tasks', async () => {
    const started: number[] = [];
    const run = bounded(1, [
      () => Promise.reject(new Error('no')),
      () => Promise.resolve(started.push(1)),
    ]);
    await expect(run).rejects.toThrow('no');
    expect(started).toEqual([]);
  });

  it('handles no tasks', async () => {
    expect(await bounded(4, [])).toEqual([]);
  });
});
