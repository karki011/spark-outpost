import { describe, expect, it } from 'vitest';
import type { StoredRunEvent } from '@spark-outpost/contracts';
import { RunEventHub } from './run-event-hub.ts';

const stored = (seq: number, text: string) =>
  ({ seq, event: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: text } }) as StoredRunEvent;

describe('RunEventHub frames', () => {
  it('writes one SSE frame per event and reuses it for every subscriber', () => {
    const hub = new RunEventHub();
    const first = hub.frame('run-a', stored(7, 'hi'));
    expect(first).toBe(
      'id: 7\ndata: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m","delta":"hi"}\n\n',
    );
    expect(hub.frame('run-a', stored(7, 'changed'))).toBe(first);
    expect(hub.frame('run-b', stored(7, 'other'))).toContain('"delta":"other"');
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
