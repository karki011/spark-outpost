import { describe, expect, it } from 'vitest';
import {
  EventType,
  OWN_SUBAGENT_METADATA,
  SUBAGENTS_ACTIVITY,
  modelSwitchText,
  type RunEvent,
} from '@spark-outpost/contracts';
import {
  applyRunEvent,
  initialRunProjection,
  shownSteps,
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

  it("keeps a worker's reply in the chat run out of the chat's own text", () => {
    const worker = { subagentRunId: 'w' };
    const withWorker: RunEvent[] = [
      events[0]!,
      { type: EventType.SUBAGENT_STARTED, name: 'conversation', ...worker },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'a', role: 'assistant', ...worker },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'a', delta: 'Still building.', ...worker },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'a', ...worker },
      { type: EventType.SUBAGENT_FINISHED, ...worker },
      ...events.slice(3),
    ];
    const state = replay(withWorker.map((event, index) => [index + 1, event]));
    expect(state).toMatchObject({ status: 'succeeded', text: 'Hello world' });
  });

  it("lists the agent's own sub-agents with their current step and what the agent waits on", () => {
    const own = { subagentRunId: 's1' };
    const live: RunEvent[] = [
      events[0]!,
      {
        type: EventType.SUBAGENT_STARTED,
        name: 'Explore',
        description: 'Find the routes',
        metadata: OWN_SUBAGENT_METADATA,
        ...own,
      },
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: SUBAGENTS_ACTIVITY,
        activityType: SUBAGENTS_ACTIVITY,
        content: { waitingOn: 1 },
        replace: true,
      },
      { type: EventType.STEP_STARTED, stepName: 'Read routes.ts', ...own },
    ];
    const state = replay(live.map((event, index) => [index + 1, event]));
    expect(state.subagents.waitingOn).toBe(1);
    expect(state.subagents.rows).toEqual([
      expect.objectContaining({ name: 'Explore', state: 'working', step: 'Read routes.ts' }),
    ]);
    expect(state.steps).toEqual([{ name: 'Read routes.ts', done: false, subagent: true }]);
    const ended = applyRunEvent(state, 9, { type: EventType.SUBAGENT_FINISHED, ...own });
    expect(ended.subagents.rows[0]).toMatchObject({ state: 'done', step: null });
  });

  it('lists no sub-agents for the worker of a stored crew turn', () => {
    const crew: RunEvent[] = [
      events[0]!,
      { type: EventType.SUBAGENT_STARTED, name: 'conversation', subagentRunId: 'w' },
    ];
    expect(replay(crew.map((event, index) => [index + 1, event])).subagents.rows).toEqual([]);
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

  it('finishes the step of the tool call that ended, not every step with that name', () => {
    const started = (toolCallId: string): RunEvent => ({
      type: EventType.STEP_STARTED,
      stepName: 'Search',
      metadata: { spark: { toolCallId } },
    });
    const state = replay([
      [1, started('a')],
      [2, started('b')],
      [
        3,
        {
          type: EventType.STEP_FINISHED,
          stepName: 'Search',
          metadata: { spark: { toolCallId: 'b' } },
        },
      ],
    ]);
    expect(state.steps.map((step) => step.done)).toEqual([false, true]);
  });

  it('finishes the oldest open step by name when a run has no tool call ids', () => {
    const state = replay([
      [1, { type: EventType.STEP_STARTED, stepName: 'Search' }],
      [2, { type: EventType.STEP_STARTED, stepName: 'Search' }],
      [3, { type: EventType.STEP_FINISHED, stepName: 'Search' }],
    ]);
    expect(state.steps).toEqual([
      { name: 'Search', done: true },
      { name: 'Search', done: false },
    ]);
  });

  it('keeps thinking text with its Thinking step and ignores tool call events', () => {
    const state = replay([
      [1, { type: EventType.STEP_STARTED, stepName: 'Thinking' }],
      [2, { type: EventType.REASONING_START, messageId: 'th' }],
      [3, { type: EventType.REASONING_MESSAGE_START, messageId: 'th', role: 'reasoning' }],
      [4, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'th', delta: 'Check ' }],
      [5, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'th', delta: 'the tests' }],
      [6, { type: EventType.REASONING_MESSAGE_END, messageId: 'th' }],
      [7, { type: EventType.REASONING_END, messageId: 'th' }],
      [8, { type: EventType.STEP_FINISHED, stepName: 'Thinking' }],
      [9, { type: EventType.TOOL_CALL_START, toolCallId: 'a', toolCallName: 'Read' }],
      [10, { type: EventType.TOOL_CALL_ARGS, toolCallId: 'a', delta: '{}' }],
      [11, { type: EventType.TOOL_CALL_END, toolCallId: 'a' }],
      [12, { type: EventType.TOOL_CALL_RESULT, toolCallId: 'a', messageId: 'm', content: 'ok' }],
    ]);
    expect(state.steps).toEqual([
      { name: 'Thinking', done: true, reasoningId: 'th', thought: 'Check the tests' },
    ]);
    expect(viewSteps(state.steps)).toEqual([
      { name: 'Thinking', status: 'done', reasoningId: 'th', thought: 'Check the tests' },
    ]);
    expect(state.lastSeq).toBe(12);
  });

  it('does not attach thinking to a step that already finished', () => {
    const state = replay([
      [1, { type: EventType.STEP_STARTED, stepName: 'Reading' }],
      [2, { type: EventType.STEP_FINISHED, stepName: 'Reading' }],
      [3, { type: EventType.REASONING_START, messageId: 'th' }],
      [4, { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'th', delta: 'lost' }],
    ]);
    expect(state.steps).toEqual([{ name: 'Reading', done: true }]);
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

describe('shownSteps', () => {
  const saved = [{ name: 'Thinking', done: true, reasoningId: 'th' }];
  const stream = { steps: [{ name: 'Thinking', done: true, reasoningId: 'th', thought: 'live' }] };

  it('shows the stream while it leads or nothing is saved yet', () => {
    expect(shownSteps(stream, saved, true)).toBe(stream.steps);
    expect(shownSteps(stream, [], false)).toBe(stream.steps);
  });

  it('keeps thinking text already streamed once the saved steps take over', () => {
    expect(shownSteps(stream, saved, false)).toEqual(stream.steps);
    expect(shownSteps({ steps: [] }, saved, false)).toBe(saved);
  });
});
