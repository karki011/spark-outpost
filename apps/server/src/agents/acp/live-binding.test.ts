import { describe, expect, it } from 'vitest';
import {
  ReleasedRead,
  createBindingSlot,
  createMessageQueue,
  reboundObserver,
  type TurnHandlers,
} from './live-binding.ts';

function handlers(name: string): TurnHandlers {
  return {
    permission: async () => ({ outcome: { outcome: 'selected', optionId: name } }),
    write: async () => ({}),
    read: async () => ({ content: name }),
    account: () => undefined,
    request: () => undefined,
    audit: undefined,
  };
}

describe('the binding slot of a live session', () => {
  it('holds a request that arrives between runs until the next run binds', async () => {
    let asked = 0;
    const slot = createBindingSlot(() => (asked += 1));

    const waiting = slot.handlers();
    expect(asked).toBe(1);
    slot.bind(handlers('second'));

    expect(await (await waiting).read({ sessionId: 's', path: '/x' })).toEqual({
      content: 'second',
    });
  });

  it('refuses a second run while one is bound, and frees the slot on unbind', () => {
    const slot = createBindingSlot(() => undefined);
    const unbind = slot.bind(handlers('first'));

    expect(() => slot.bind(handlers('second'))).toThrow(/already bound/);
    unbind();
    expect(slot.current()).toBeNull();
    expect(() => slot.bind(handlers('third'))).not.toThrow();
  });

  it('fails held requests when the session closes', async () => {
    const slot = createBindingSlot(() => undefined);
    const waiting = slot.handlers();

    slot.close(new Error('closed'));

    await expect(waiting).rejects.toThrow('closed');
    await expect(slot.handlers()).rejects.toThrow('closed');
  });
});

describe('the update queue of a live session', () => {
  it('keeps an update that arrives after a run released its read for the next reader', async () => {
    const queue = createMessageQueue<string>();
    const abandoned = queue.next();
    queue.release();
    await expect(abandoned).rejects.toBeInstanceOf(ReleasedRead);

    queue.push('later');

    expect(queue.size()).toBe(1);
    expect(await queue.next()).toBe('later');
  });

  it('drops updates after the session has closed', async () => {
    const queue = createMessageQueue<string>();
    queue.fail(new Error('closed'));

    queue.push('stale');

    expect(queue.size()).toBe(0);
    await expect(queue.next()).rejects.toThrow('closed');
  });
});

describe('the protocol tap of a live session', () => {
  it('holds messages seen between runs for the next run’s audit', () => {
    const tap = reboundObserver();
    const seen: unknown[] = [];
    tap.observer.message('from_agent', { id: 1 });

    tap.bind({ message: (_direction, message) => seen.push(message), stderr: () => undefined });
    tap.observer.message('from_agent', { id: 2 });

    expect(seen).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
