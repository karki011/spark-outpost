import {
  EventType,
  SUBAGENTS_ACTIVITY,
  SUBAGENT_REPORT,
  type RunEvent,
} from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../providers/provider.ts';
import { createSubagentProgress } from './subagent-progress.ts';

const started = (id: string, parentId: string | null = null): ProviderOutput => ({
  kind: 'subagent_started',
  id,
  parentId,
  name: `name ${id}`,
  task: 'task with sk-secret',
});

function waits(events: readonly RunEvent[]): number[] {
  return events.flatMap((event) =>
    event.type === EventType.ACTIVITY_SNAPSHOT && event.activityType === SUBAGENTS_ACTIVITY
      ? [(event.content as { waitingOn: number }).waitingOn]
      : [],
  );
}

function progress() {
  const tracker = createSubagentProgress({
    storable: (text) => text.replace('sk-secret', '[redacted]'),
    now: () => 42,
  });
  const all: RunEvent[] = [];
  const see = (...outputs: ProviderOutput[]) => {
    const events = outputs.flatMap((output) => tracker.observe(output));
    all.push(...events);
    return events;
  };
  return { see, all };
}

describe('sub-agent progress', () => {
  it('records a sub-agent with its name, redacted task, parent and start time', () => {
    const { see } = progress();
    see(started('a'));
    const [event] = see(started('b', 'a'));
    expect(event).toMatchObject({
      type: EventType.SUBAGENT_STARTED,
      subagentRunId: 'b',
      name: 'name b',
      description: 'task with [redacted]',
      parentSubagentRunId: 'a',
      timestamp: 42,
      metadata: { spark: { ownSubagent: true } },
    });
  });

  it('records how each sub-agent ended', () => {
    const { see } = progress();
    see(started('a'), started('b'), started('c'));
    expect(see({ kind: 'subagent_finished', id: 'a', state: 'done' })[0]).toMatchObject({
      type: EventType.SUBAGENT_FINISHED,
      subagentRunId: 'a',
      timestamp: 42,
    });
    expect(see({ kind: 'subagent_finished', id: 'b', state: 'failed' })[0]).toMatchObject({
      type: EventType.SUBAGENT_ERROR,
      code: 'failed',
    });
    expect(see({ kind: 'subagent_finished', id: 'c', state: 'cancelled' })[0]).toMatchObject({
      type: EventType.SUBAGENT_ERROR,
      code: 'cancelled',
    });
    expect(see({ kind: 'subagent_finished', id: 'c', state: 'cancelled' })).toEqual([]);
  });

  it('says the main agent waits only while it has no step of its own open', () => {
    const { see, all } = progress();
    see({ kind: 'step_started', name: 'Starting a subagent', tool: true });
    see({ kind: 'step_finished', name: 'Starting a subagent' });
    see(started('a'));
    see(started('b'));
    see({ kind: 'step_started', name: 'Read a.ts', tool: true, subagent: 'a' });
    see({ kind: 'step_started', name: 'Thinking' });
    see({ kind: 'step_finished', name: 'Thinking' });
    see({ kind: 'subagent_finished', id: 'a', state: 'done' });
    see({ kind: 'subagent_finished', id: 'b', state: 'done' });
    expect(waits(all)).toEqual([1, 2, 0, 2, 1, 0]);
  });

  it('keeps saying the main agent waits while its only open step is the wait itself', () => {
    const { see, all } = progress();
    see(started('a'));
    see({ kind: 'step_started', name: 'Waiting for sub-agents', tool: true, waits: true });
    see({ kind: 'step_finished', name: 'Waiting for sub-agents', tool: true, waits: true });
    see({ kind: 'step_started', name: 'Allowed: Edit a.ts', subagent: 'a' });
    see({ kind: 'step_finished', name: 'Allowed: Edit a.ts', subagent: 'a' });
    expect(waits(all)).toEqual([1]);
  });

  it('stores what a sub-agent did and used, with its words redacted', () => {
    const { see } = progress();
    see(started('a'));
    const [event] = see({
      kind: 'subagent_report',
      id: 'a',
      report: {
        usage: { tokens: 3400, toolUses: 7, input: 3000, output: 400, costUsd: 0.04 },
        files: ['/work/a.ts'],
        commands: ['echo sk-secret'],
        message: 'The key is sk-secret',
      },
    });
    expect(event).toEqual({
      type: EventType.CUSTOM,
      name: SUBAGENT_REPORT,
      value: {
        id: 'a',
        usage: { tokens: 3400, toolUses: 7, costUsd: 0.04 },
        files: ['/work/a.ts'],
        commands: ['echo [redacted]'],
        message: 'The key is [redacted]',
      },
    });
  });

  it('says nothing about waiting in a turn without sub-agents', () => {
    const { see, all } = progress();
    see({ kind: 'step_started', name: 'Thinking' }, { kind: 'step_finished', name: 'Thinking' });
    expect(all).toEqual([]);
  });
});
