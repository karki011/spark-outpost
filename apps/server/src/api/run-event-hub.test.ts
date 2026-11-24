import { describe, expect, it } from 'vitest';
import type { StoredRunEvent } from '@spark-outpost/contracts';
import { RunEventHub, endFrame } from './run-event-hub.ts';

const stored = (seq: number, text: string) =>
  ({ seq, event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: text } }) as StoredRunEvent;

describe('RunEventHub frames', () => {
  it('writes one SSE frame per event that names its run, and reuses it for every subscriber', () => {
    const hub = new RunEventHub();
    const first = hub.frame('run-a', stored(7, 'hi'));
    expect(first).toBe(
      'data: {"runId":"run-a","seq":7,"event":{"type":"TEXT_MESSAGE_CONTENT","messageId":"m","delta":"hi"}}\n\n',
    );
    expect(hub.frame('run-a', stored(7, 'changed'))).toBe(first);
    expect(hub.frame('run-b', stored(7, 'other'))).toContain('"delta":"other"');
    expect(endFrame('run-a', 'done')).toBe('data: {"runId":"run-a","end":"done"}\n\n');
  });

  it('keeps only recent frames', () => {
    const hub = new RunEventHub();
    hub.frame('run', stored(1, 'old'));
    for (let seq = 2; seq <= 2_001; seq += 1) hub.frame('run', stored(seq, 'x'));
    expect(hub.frame('run', stored(1, 'fresh'))).toContain('"delta":"fresh"');
    hub.frame('big', stored(1, 'y'.repeat(5_000_000)));
    expect(hub.frame('big', stored(1, 'small'))).toContain('"delta":"small"');
  });
});

describe('RunEventHub watches', () => {
  it('keeps a notice that arrives while the stream is busy, so no run waits for the poll', async () => {
    const hub = new RunEventHub();
    const watch = hub.watch(['a', 'b']);
    expect(watch.take().sort()).toEqual(['a', 'b']);
    hub.notify('b');
    hub.notify('b');
    const signal = new AbortController().signal;
    const started = Date.now();
    await watch.changed(5_000, signal);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(watch.take()).toEqual(['b']);
    watch.close();
  });

  it('wakes on a notice, marks every run due after the fallback wait, and forgets dropped runs', async () => {
    const hub = new RunEventHub();
    const watch = hub.watch(['a', 'b']);
    watch.take();
    const signal = new AbortController().signal;
    const woken = watch.changed(5_000, signal);
    hub.notify('a');
    await woken;
    expect(watch.take()).toEqual(['a']);

    watch.drop('a');
    hub.notify('a');
    await watch.changed(10, signal);
    expect(watch.take()).toEqual(['b']);
    watch.close();
  });
});

describe('RunEventHub shared event loads', () => {
  function deferredLoads() {
    const settle: ((batch: StoredRunEvent[]) => void)[] = [];
    const fail: ((error: Error) => void)[] = [];
    const load = () =>
      new Promise<StoredRunEvent[]>((resolve, reject) => {
        settle.push(resolve);
        fail.push(reject);
      });
    return { settle, fail, load };
  }

  it('loads once for subscribers waiting at the same cursor of a run', async () => {
    const hub = new RunEventHub();
    const loads = deferredLoads();
    const first = hub.eventsAfter('run', 3, loads.load);
    const second = hub.eventsAfter('run', 3, loads.load);
    expect(loads.settle).toHaveLength(1);
    loads.settle[0]!([stored(4, 'a'), stored(5, 'b')]);
    expect(await first).toEqual([stored(4, 'a'), stored(5, 'b')]);
    expect(await second).toBe(await first);
  });

  it('loads separately for another cursor and for another run', async () => {
    const hub = new RunEventHub();
    const loads = deferredLoads();
    const behind = hub.eventsAfter('run', 0, loads.load);
    const ahead = hub.eventsAfter('run', 3, loads.load);
    const other = hub.eventsAfter('other', 3, loads.load);
    expect(loads.settle).toHaveLength(3);
    loads.settle[0]!([stored(1, 'a')]);
    loads.settle[1]!([stored(4, 'd')]);
    loads.settle[2]!([]);
    expect(await behind).toEqual([stored(1, 'a')]);
    expect(await ahead).toEqual([stored(4, 'd')]);
    expect(await other).toEqual([]);
  });

  it('never hands a subscriber a load that began before the latest notice', async () => {
    const hub = new RunEventHub();
    const loads = deferredLoads();
    const early = hub.eventsAfter('run', 3, loads.load);
    hub.notify('other');
    expect(hub.eventsAfter('run', 3, loads.load)).toBe(early);
    hub.notify('run');
    const late = hub.eventsAfter('run', 3, loads.load);
    expect(loads.settle).toHaveLength(2);
    loads.settle[0]!([stored(4, 'a')]);
    loads.settle[1]!([stored(4, 'a'), stored(5, 'b')]);
    expect(await early).toEqual([stored(4, 'a')]);
    expect(await late).toEqual([stored(4, 'a'), stored(5, 'b')]);
  });

  it('loads again once a shared load has settled or failed', async () => {
    const hub = new RunEventHub();
    const loads = deferredLoads();
    const first = hub.eventsAfter('run', 3, loads.load);
    const joined = hub.eventsAfter('run', 3, loads.load);
    loads.fail[0]!(new Error('database gone'));
    await expect(first).rejects.toThrow('database gone');
    await expect(joined).rejects.toThrow('database gone');
    const retried = hub.eventsAfter('run', 3, loads.load);
    expect(loads.settle).toHaveLength(2);
    loads.settle[1]!([]);
    expect(await retried).toEqual([]);
    const after = hub.eventsAfter('run', 3, loads.load);
    expect(loads.settle).toHaveLength(3);
    loads.settle[2]!([stored(4, 'a')]);
    expect(await after).toEqual([stored(4, 'a')]);
  });
});
