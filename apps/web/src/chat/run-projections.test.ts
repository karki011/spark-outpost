import { describe, expect, it } from 'vitest';
import { EventType, type RunEvent } from '@spark-outpost/contracts';
import { RunProjections } from './run-projections.ts';
import type { RunListener } from './run-stream-client.ts';

const started: RunEvent = { type: EventType.RUN_STARTED, runId: 'r', threadId: 't' };
const opens: RunEvent = { type: EventType.TEXT_MESSAGE_START, messageId: 'm', role: 'assistant' };
const says = (delta: string): RunEvent => ({
  type: EventType.TEXT_MESSAGE_CONTENT,
  messageId: 'm',
  delta,
});
const finished: RunEvent = {
  type: EventType.RUN_FINISHED,
  runId: 'r',
  threadId: 't',
  outcome: { type: 'success' },
};

function fakeSource() {
  const live = new Map<string, RunListener>();
  const subscribed: string[] = [];
  let seq = 0;
  return {
    live,
    subscribed,
    send(runId: string, event: RunEvent) {
      seq += 1;
      live.get(runId)?.event(seq, event);
    },
    subscribe(runId: string, _chat: string, listener: RunListener) {
      subscribed.push(runId);
      live.set(runId, listener);
      return () => live.delete(runId);
    },
  };
}

function kept(keep = 2) {
  const source = fakeSource();
  const frames: (() => void)[] = [];
  const projections = new RunProjections(
    source,
    keep,
    (apply) => frames.push(apply),
    () => undefined,
  );
  const paint = () => frames.splice(0).forEach((apply) => apply());
  return { source, projections, paint };
}

const text = (projections: RunProjections, runId: string) => projections.read(runId).text;

describe('following a running turn', () => {
  it('keeps following after the chat is left, so coming back shows the text already there', () => {
    const { source, projections, paint } = kept();
    let changes = 0;
    const leave = projections.watch('r1', 'chat', () => (changes += 1));
    for (const event of [started, opens, says('Hello ')]) source.send('r1', event);
    paint();
    expect(changes).toBe(1);
    leave();
    source.send('r1', says('world'));
    expect(text(projections, 'r1')).toBe('Hello world');
    projections.watch('r1', 'chat', () => undefined);
    expect(source.subscribed).toEqual(['r1']);
    expect(text(projections, 'r1')).toBe('Hello world');
  });

  it('stops following a turn that ended while nobody watched', () => {
    const { source, projections } = kept();
    projections.watch('r1', 'chat', () => undefined)();
    source.send('r1', started);
    source.send('r1', finished);
    expect(source.live.has('r1')).toBe(false);
  });

  it('stops following a finished turn as soon as its chat is left', () => {
    const { source, projections } = kept();
    const leave = projections.watch('r1', 'chat', () => undefined);
    source.send('r1', started);
    source.send('r1', finished);
    expect(source.live.has('r1')).toBe(true);
    leave();
    expect(source.live.has('r1')).toBe(false);
  });

  it('follows only the most recent few turns of chats that were left', () => {
    const { source, projections } = kept(2);
    for (const runId of ['r1', 'r2', 'r3']) projections.watch(runId, 'chat', () => undefined)();
    expect([...source.live.keys()]).toEqual(['r2', 'r3']);
    const open = projections.watch('r4', 'chat', () => undefined);
    expect([...source.live.keys()]).toEqual(['r2', 'r3', 'r4']);
    open();
    expect([...source.live.keys()]).toEqual(['r3', 'r4']);
  });

  it('starts following a turn when its chat is hovered, before anything is on screen', () => {
    const { source, projections } = kept();
    projections.warm('r1', 'chat');
    for (const event of [started, opens, says('Ready')]) source.send('r1', event);
    expect(text(projections, 'r1')).toBe('Ready');
    projections.watch('r1', 'chat', () => undefined);
    expect(source.subscribed).toEqual(['r1']);
  });
});
