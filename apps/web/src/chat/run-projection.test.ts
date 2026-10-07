import { describe, expect, it } from 'vitest';
import { EventType, modelSwitchText, type RunEvent } from '@spark-outpost/contracts';
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

  it('keeps a step open when it was only closed because the run stopped', () => {
    const state = replay([
      [1, { type: EventType.STEP_STARTED, stepName: 'Running tests' }],
      [
        2,
        {
          type: EventType.STEP_FINISHED,
          stepName: 'Running tests',
          metadata: { spark: { interrupted: true } },
        },
      ],
      [
        3,
        { type: EventType.RUN_FINISHED, runId: 'r', threadId: 't', outcome: { type: 'cancelled' } },
      ],
    ]);
    expect(state.steps).toEqual([{ name: 'Running tests', done: false }]);
    expect(state.status).toBe('cancelled');
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

describe('a model switch during a run', () => {
  const change = {
    provider: 'codex',
    signIn: 'ChatGPT sign-in',
    from: { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
    to: { id: 'gpt-6-sol', label: '6 Sol' },
    learned: true,
  };
  const activity = (content: Record<string, unknown>): RunEvent => ({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: 'model_switch',
    activityType: 'model_switch',
    content,
    replace: true,
  });

  it('is kept for the live note and ignores a malformed payload', () => {
    expect(replay([[1, activity(change)]]).modelSwitch).toEqual(change);
    expect(replay([[1, activity({ from: 'x' })]]).modelSwitch).toBeNull();
    expect(modelSwitchText(change)).toBe(
      "Your ChatGPT sign-in can't use GPT-6.1 Sol, so this turn ran on 6 Sol instead.",
    );
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
