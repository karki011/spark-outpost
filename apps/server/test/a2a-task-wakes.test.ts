import type { AppEvent } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { movesTasks, TaskWakes } from '../src/a2a/task-wakes.ts';

const outpost: AppEvent = { kind: 'outpost_changed', conversationId: null, runId: null };
const map: AppEvent = { kind: 'map', conversationId: null, runId: null };

async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe('task wake-ups', () => {
  it('wakes every waiter on a change that can move a request', async () => {
    const wakes = new TaskWakes();
    const signal = new AbortController().signal;
    const first = wakes.next(signal);
    const second = wakes.next(signal);
    expect(wakes.waiters).toBe(2);
    expect(await settled(first)).toBe(false);
    wakes.changed(outpost);
    expect(await settled(first)).toBe(true);
    expect(await settled(second)).toBe(true);
    expect(wakes.waiters).toBe(0);
  });

  it('wakes every waiter when told changes may have been missed', async () => {
    const wakes = new TaskWakes();
    const waiting = wakes.next(new AbortController().signal);
    wakes.wakeAll();
    expect(await settled(waiting)).toBe(true);
    expect(wakes.waiters).toBe(0);
  });

  it('ignores changes that cannot move a request', async () => {
    const wakes = new TaskWakes();
    const waiting = wakes.next(new AbortController().signal);
    wakes.changed(map);
    expect(await settled(waiting)).toBe(false);
    expect(movesTasks(map)).toBe(false);
    expect(
      (['outpost_changed', 'run', 'approval', 'conversation'] as const).every((kind) =>
        movesTasks({ ...outpost, kind }),
      ),
    ).toBe(true);
  });

  it('lets a waiter go when its caller leaves, and keeps none behind', async () => {
    const wakes = new TaskWakes();
    const caller = new AbortController();
    const waiting = wakes.next(caller.signal);
    caller.abort();
    expect(await settled(waiting)).toBe(true);
    expect(wakes.waiters).toBe(0);
    expect(await settled(wakes.next(caller.signal))).toBe(true);
    expect(wakes.waiters).toBe(0);
  });

  it('wakes a waiter once', async () => {
    const wakes = new TaskWakes();
    const waiting = wakes.next(new AbortController().signal);
    wakes.changed(outpost);
    await waiting;
    wakes.changed(outpost);
    expect(wakes.waiters).toBe(0);
  });
});
