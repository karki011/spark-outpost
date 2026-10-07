import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@spark-outpost/contracts';
import type { AppendOptions } from '../persistence/run-events.ts';
import { bufferingText, flushBufferedText, TEXT_FLUSH_MS } from './run-appender.ts';
import { runEvents } from './run-events.ts';

interface Written {
  events: readonly RunEvent[];
  options: AppendOptions | undefined;
}

function recorder() {
  const writes: Written[] = [];
  let failNext: Error | null = null;
  let seq = 0;
  const write = async (events: readonly RunEvent[], options?: AppendOptions) => {
    if (failNext) {
      const error = failNext;
      failNext = null;
      throw error;
    }
    writes.push({ events, options });
    seq += events.length;
    return seq;
  };
  return {
    writes,
    write,
    failNextWrite: (error: Error) => {
      failNext = error;
    },
    deltas: () =>
      writes.map((entry) =>
        entry.events.map((event) => ('delta' in event ? event.delta : event.type)),
      ),
  };
}

const text = (delta: string) => runEvents.textContent('message-1', delta);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buffering streamed text', () => {
  it('writes the first chunk at once and later chunks together within the window', async () => {
    const store = recorder();
    const append = bufferingText(store.write);
    expect(await append(text('a'))).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.deltas()).toEqual([['a']]);

    await append(text('b'));
    await append(text('c'));
    await append(text('d'));
    await vi.advanceTimersByTimeAsync(TEXT_FLUSH_MS - 1);
    expect(store.deltas()).toEqual([['a']]);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.deltas()).toEqual([['a'], ['b', 'c', 'd']]);
  });

  it('writes waiting text before any other event, in the same write', async () => {
    const store = recorder();
    const append = bufferingText(store.write);
    await append(text('a'));
    await vi.advanceTimersByTimeAsync(0);
    await append(text('b'));
    await append(text('c'));
    const seq = await append(runEvents.stepStarted('Edit file'));
    expect(seq).toBe(4);
    expect(store.deltas()).toEqual([['a'], ['b', 'c', 'STEP_STARTED']]);
    await vi.advanceTimersByTimeAsync(TEXT_FLUSH_MS * 2);
    expect(store.writes).toHaveLength(2);
  });

  it('keeps the options of the event that closes a message', async () => {
    const store = recorder();
    const append = bufferingText(store.write);
    await append(text('a'));
    await append(text('b'));
    const options = { assistantMessage: { id: 'message-1', content: 'ab' } };
    await append(runEvents.textEnd('message-1'), options);
    expect(store.deltas()).toEqual([['a', 'b', 'TEXT_MESSAGE_END']]);
    expect(store.writes[0]?.options).toBe(options);
  });

  it('writes straight away once enough text is waiting', async () => {
    const store = recorder();
    const append = bufferingText(store.write, { flushChars: 6 });
    await append(text('a'));
    await vi.advanceTimersByTimeAsync(0);
    await append(text('bbb'));
    expect(store.deltas()).toEqual([['a']]);
    await append(text('ccc'));
    expect(store.deltas()).toEqual([['a'], ['bbb', 'ccc']]);
  });

  it('keeps writes in the order they were asked for', async () => {
    const store = recorder();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowFirst = async (events: readonly RunEvent[], options?: AppendOptions) => {
      if (order.length === 0) {
        order.push('first started');
        await held;
      }
      order.push(events.map((event) => event.type).join(','));
      return store.write(events, options);
    };
    const append = bufferingText(slowFirst);
    const first = append(runEvents.stepStarted('one'));
    await append(text('a'));
    const second = append(runEvents.stepFinished('one'));
    release();
    await Promise.all([first, second]);
    expect(store.deltas()).toEqual([['STEP_STARTED'], ['a', 'STEP_FINISHED']]);
  });

  it('raises a failed timed write on the next append, once', async () => {
    const store = recorder();
    const append = bufferingText(store.write);
    const lost = new Error('lease lost');
    store.failNextWrite(lost);
    await append(text('a'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(append(text('b'))).rejects.toBe(lost);
    await append(runEvents.stepStarted('after'));
    expect(store.deltas()).toEqual([['STEP_STARTED']]);
  });

  it('gives a failed write to the caller of a plain event', async () => {
    const store = recorder();
    const append = bufferingText(store.write);
    const broken = new Error('database is down');
    store.failNextWrite(broken);
    await expect(append(runEvents.stepStarted('one'))).rejects.toBe(broken);
    await append(runEvents.stepFinished('one'));
    expect(store.deltas()).toEqual([['STEP_FINISHED']]);
  });

  it('writes waiting text when the worker shuts down', async () => {
    const store = recorder();
    const append = bufferingText(store.write);
    await append(text('a'));
    await vi.advanceTimersByTimeAsync(0);
    await append(text('b'));
    await flushBufferedText();
    expect(store.deltas()).toEqual([['a'], ['b']]);
    await vi.advanceTimersByTimeAsync(TEXT_FLUSH_MS * 2);
    expect(store.writes).toHaveLength(2);
  });
});

describe('closing what is still open', () => {
  const identity = { runId: 'run-1', threadId: 'thread-1' };

  it('finishes open steps as interrupted in the same write as the terminal event', async () => {
    const store = recorder();
    const append = bufferingText(store.write);
    await append(runEvents.stepStarted('Reading'));
    await append(runEvents.stepFinished('Reading'));
    await append(runEvents.stepStarted('Running tests'));
    await append(runEvents.cancelled(identity));
    expect(store.writes.at(-1)?.events).toEqual([
      runEvents.stepFinished('Running tests', { interrupted: true }),
      runEvents.cancelled(identity),
    ]);
  });

  it('adds nothing when every step finished, or when the terminal event is written twice', async () => {
    const store = recorder();
    const append = bufferingText(store.write);
    await append(runEvents.stepStarted('Reading'));
    await append(runEvents.error('Failed', 'provider_error'));
    await append(runEvents.error('Failed', 'provider_error'));
    expect(store.writes.slice(-2).map((entry) => entry.events.length)).toEqual([2, 1]);
  });
});
