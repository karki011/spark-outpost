import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@spark-outpost/contracts';
import { RunStreamClient } from './run-stream-client.ts';

const A = '0198c0de-0000-7000-8000-00000000000a';
const B = '0198c0de-0000-7000-8000-00000000000b';

class FakeSource {
  static all: FakeSource[] = [];
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  runs(): string {
    return decodeURIComponent(new URL(this.url, 'http://x').searchParams.get('runs') ?? '');
  }
  send(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>);
  }
  text(runId: string, seq: number) {
    this.send({
      runId,
      seq,
      event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: `${seq}` },
    });
  }
}

const open = () => FakeSource.all.filter((source) => !source.closed);
const latest = () => FakeSource.all.at(-1)!;
const settle = () => Promise.resolve();

function recorder() {
  const seen: number[] = [];
  return { seen, listener: { event: (seq: number) => seen.push(seq) } };
}

let effects: { chat: string; event: RunEvent }[];
let client: RunStreamClient;

beforeEach(() => {
  FakeSource.all = [];
  effects = [];
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeSource);
  client = new RunStreamClient((chat, event) => effects.push({ chat, event }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RunStreamClient', () => {
  it('opens one connection for every run shown at once, even when a block mounts twice', async () => {
    const stop = client.subscribe(A, 'chat', recorder().listener);
    stop();
    client.subscribe(A, 'chat', recorder().listener);
    client.subscribe(B, 'chat', recorder().listener);
    await settle();

    expect(FakeSource.all).toHaveLength(1);
    expect(latest().url.startsWith('/api/run-events?runs=')).toBe(true);
    expect(latest().runs()).toBe(`${A}:0,${B}:0`);
  });

  it('hands each run its own events in order and drops repeated or stale ones', async () => {
    const a = recorder();
    const b = recorder();
    client.subscribe(A, 'chat-a', a.listener);
    client.subscribe(B, 'chat-b', b.listener);
    await settle();
    const source = latest();

    source.text(A, 1);
    source.text(B, 1);
    source.text(A, 2);
    source.text(A, 2);
    source.text(A, 1);
    source.text(B, 2);

    expect(a.seen).toEqual([1, 2]);
    expect(b.seen).toEqual([1, 2]);
    expect(effects.map((effect) => effect.chat)).toEqual(['chat-a', 'chat-b', 'chat-a', 'chat-b']);
  });

  it('reconnects after a drop from the cursor each run reached, and applies nothing twice', async () => {
    const a = recorder();
    client.subscribe(A, 'chat', a.listener);
    await settle();
    latest().text(A, 1);
    latest().text(A, 2);
    latest().onerror?.();
    expect(open()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(open()).toHaveLength(1);
    expect(latest().runs()).toBe(`${A}:2`);
    latest().text(A, 2);
    latest().text(A, 3);
    expect(a.seen).toEqual([1, 2, 3]);
    expect(effects).toHaveLength(3);
  });

  it('gets the tail and the end of a run that finished while the connection was down, then closes', async () => {
    const a = recorder();
    client.subscribe(A, 'chat', a.listener);
    await settle();
    latest().text(A, 1);
    latest().onerror?.();
    await vi.advanceTimersByTimeAsync(1_000);

    latest().text(A, 2);
    latest().send({
      runId: A,
      seq: 3,
      event: { type: 'RUN_FINISHED', threadId: 't', runId: A },
    });
    latest().send({ runId: A, end: 'done' });
    await settle();

    expect(a.seen).toEqual([1, 2, 3]);
    expect(open()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSource.all).toHaveLength(2);
  });

  it('replays a live run for a block that joins late without repeating it for the first one', async () => {
    const first = recorder();
    client.subscribe(A, 'chat', first.listener);
    await settle();
    latest().text(A, 1);
    latest().text(A, 2);

    const late = recorder();
    client.subscribe(A, 'chat', late.listener);
    await settle();
    expect(open()).toHaveLength(1);
    expect(latest().runs()).toBe(`${A}:0`);
    latest().text(A, 1);
    latest().text(A, 2);
    latest().text(A, 3);

    expect(first.seen).toEqual([1, 2, 3]);
    expect(late.seen).toEqual([1, 2, 3]);
    expect(effects).toHaveLength(3);
  });

  it('closes the connection when the last block goes away and opens none for an unknown run', async () => {
    const stop = client.subscribe(A, 'chat', recorder().listener);
    client.subscribe(B, 'chat', recorder().listener);
    await settle();
    latest().send({ runId: B, end: 'missing' });
    stop();
    await settle();

    expect(open()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSource.all).toHaveLength(1);
  });
});
