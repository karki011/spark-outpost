import { describe, expect, it } from 'vitest';
import { EventType, stepMark, type RunEvent } from '@spark-outpost/contracts';
import type { ProviderOutput } from '../providers/provider.ts';
import { createTurnEvents } from './turn-events.ts';

async function eventsFor(outputs: readonly ProviderOutput[], close = true): Promise<RunEvent[]> {
  const written: RunEvent[] = [];
  const events = createTurnEvents({
    append: async (event) => {
      written.push(event);
    },
    secretValues: ['hunter2-value'],
  });
  for (const output of outputs) await events.observe(output);
  if (close) await events.close();
  return written;
}

const types = (events: readonly RunEvent[]) => events.map((event) => event.type);
const step = (kind: 'step_started' | 'step_finished', name: string): ProviderOutput => ({
  kind,
  name,
  tool: true,
});

describe('turn events', () => {
  it('opens one step for two calls with the same name and closes it after the last', async () => {
    const events = await eventsFor([
      { kind: 'tool_started', id: 'a', name: 'Search' },
      step('step_started', 'Search'),
      { kind: 'tool_started', id: 'b', name: 'Search' },
      step('step_started', 'Search'),
      { kind: 'tool_input', id: 'a', input: { q: 1 }, secret: false },
      { kind: 'tool_result', id: 'a', output: 'one', secret: false },
      step('step_finished', 'Search'),
      { kind: 'tool_input', id: 'b', input: null, secret: false },
      { kind: 'tool_result', id: 'b', output: '', secret: false },
      step('step_finished', 'Search'),
    ]);
    expect(types(events)).toEqual([
      'TOOL_CALL_START',
      'STEP_STARTED',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'STEP_FINISHED',
    ]);
    expect(stepMark(events[1]!)).toEqual({ toolCallId: 'a' });
    expect(stepMark(events.at(-1)!)).toEqual({ toolCallId: 'a' });
  });

  it("marks the agent's wait for its sub-agents on the step it opens", async () => {
    const events = await eventsFor([
      { kind: 'step_started', name: 'Waiting for sub-agents', tool: true, waits: true },
      { kind: 'step_started', name: 'Read a.ts', tool: true },
    ]);
    const marks = events.flatMap((event) =>
      event.type === EventType.STEP_STARTED ? [stepMark(event).waits ?? false] : [],
    );
    expect(marks).toEqual([true, false]);
  });

  it('ignores a repeated start, input or result, and anything for a call it never saw', async () => {
    const events = await eventsFor([
      { kind: 'tool_result', id: 'ghost', output: 'x', secret: false },
      { kind: 'tool_input', id: 'ghost', input: {}, secret: false },
      { kind: 'tool_started', id: 'a', name: 'Read' },
      { kind: 'tool_started', id: 'a', name: 'Read' },
      { kind: 'tool_result', id: 'a', output: 'early', secret: false },
      { kind: 'tool_input', id: 'a', input: { path: 'a.ts' }, secret: false },
      { kind: 'tool_input', id: 'a', input: { path: 'b.ts' }, secret: false },
      step('step_finished', 'Never started'),
    ]);
    expect(types(events)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END']);
  });

  it('streams thinking as one span, redacted, and ends it when the Thinking step finishes', async () => {
    const events = await eventsFor(
      [
        { kind: 'step_started', name: 'Thinking' },
        { kind: 'thought_delta', delta: 'use hunter2-value ' },
        { kind: 'thought_delta', delta: 'then stop' },
        { kind: 'step_finished', name: 'Thinking' },
      ],
      false,
    );
    expect(types(events).filter((type) => type !== EventType.REASONING_MESSAGE_CONTENT)).toEqual([
      'STEP_STARTED',
      'REASONING_START',
      'REASONING_MESSAGE_START',
      'REASONING_MESSAGE_END',
      'REASONING_END',
      'STEP_FINISHED',
    ]);
    const text = events.flatMap((event) =>
      event.type === EventType.REASONING_MESSAGE_CONTENT ? [event.delta] : [],
    );
    expect(text.join('')).toBe('use [redacted:secret_value] then stop');
  });

  it('ends thinking that is still open when the turn closes, and only once', async () => {
    const written: RunEvent[] = [];
    const events = createTurnEvents({
      append: async (event) => {
        written.push(event);
      },
      secretValues: [],
    });
    await events.observe({ kind: 'thought_delta', delta: 'half a thought' });
    await events.close();
    await events.close();
    expect(types(written).slice(-2)).toEqual(['REASONING_MESSAGE_END', 'REASONING_END']);
    expect(types(written).filter((type) => type === EventType.REASONING_END)).toHaveLength(1);
  });
});
