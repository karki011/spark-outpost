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
