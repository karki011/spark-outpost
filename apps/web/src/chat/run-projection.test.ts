import { describe, expect, it } from 'vitest';
import { EventType, type RunEvent } from '@spark-outpost/contracts';
import {
  applyRunEvent,
  initialRunProjection,
  shownText,
  streamLeads,
  viewSteps,
  type RunProjection,
} from './run-projection.ts';

const events: RunEvent[] = [
  { type: EventType.RUN_STARTED, runId: 'r', threadId: 't' },
  { type: EventType.STEP_STARTED, stepName: 'Reading' },
  { type: EventType.STEP_FINISHED, stepName: 'Reading' },
  { type: EventType.TEXT_MESSAGE_START, messageId: 'm', role: 'assistant' },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm', delta: 'Hello ' },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm', delta: 'world' },
  { type: EventType.TEXT_MESSAGE_END, messageId: 'm' },
  { type: EventType.RUN_FINISHED, runId: 'r', threadId: 't', outcome: { type: 'success' } },
];

function replay(list: [number, RunEvent][]): RunProjection {
  return list.reduce(
    (state, [seq, event]) => applyRunEvent(state, seq, event),
    initialRunProjection,
  );
}

describe('applyRunEvent', () => {
  it('builds steps, text, and the final status', () => {
    const state = replay(events.map((event, index) => [index + 1, event]));
    expect(state).toMatchObject({
      status: 'succeeded',
      steps: [{ name: 'Reading', done: true }],
      text: 'Hello world',
      lastSeq: 8,
    });
  });

  it('ignores replayed events it has already applied', () => {
    const numbered = events.map((event, index): [number, RunEvent] => [index + 1, event]);
    const withReplay = [...numbered.slice(0, 6), ...numbered.slice(3)];
    expect(replay(withReplay).text).toBe('Hello world');
  });

  it('reports cancellation and errors', () => {
    const cancelled = applyRunEvent(initialRunProjection, 1, {
      type: EventType.RUN_FINISHED,
      runId: 'r',
      threadId: 't',
      outcome: { type: 'cancelled' },
    });
    expect(cancelled.status).toBe('cancelled');
    const failed = applyRunEvent(initialRunProjection, 1, {
      type: EventType.RUN_ERROR,
      message: 'Rate limit reached',
    });
    expect(failed).toMatchObject({ status: 'failed', error: 'Rate limit reached' });
  });
});

describe('viewSteps', () => {
  it('folds a failure note into the step it names and keeps open steps open', () => {
    expect(
      viewSteps([
        { name: 'Read `a.ts`', done: true },
        { name: 'Failed: Read `a.ts`', done: true },
        { name: 'Search', done: false },
        { name: 'Failed: Unknown', done: true },
      ]),
    ).toEqual([
      { name: 'Read `a.ts`', status: 'failed' },
      { name: 'Search', status: 'open' },
      { name: 'Failed: Unknown', status: 'done' },
    ]);
  });
});

describe('shownText', () => {
  const streaming: RunProjection = {
    ...initialRunProjection,
    status: 'running',
    text: 'Hello wor',
    lastSeq: 7,
  };
  const done: RunProjection = { ...streaming, status: 'succeeded', text: 'Hello world' };

  it('keeps the streamed text while the run is live, even if a refetch has the final text', () => {
    expect(shownText(streaming, 'Hello world', false)).toBe('Hello wor');
  });

  it('keeps the streamed text while the stream catches up to a finished run', () => {
    expect(streamLeads(streaming, true)).toBe(true);
    expect(shownText(streaming, 'Hello world', true)).toBe('Hello wor');
  });

  it('hands over to the persisted text once the stream has finished', () => {
    expect(streamLeads(done, true)).toBe(false);
    expect(shownText(done, 'Hello world!', true)).toBe('Hello world!');
  });

  it('keeps the streamed text until the persisted message arrives', () => {
    expect(shownText(done, undefined, true)).toBe('Hello world');
  });

  it('uses the persisted text for a finished run that never streamed', () => {
    expect(streamLeads(initialRunProjection, true)).toBe(false);
    expect(shownText(initialRunProjection, 'Stored reply', true)).toBe('Stored reply');
  });
});
