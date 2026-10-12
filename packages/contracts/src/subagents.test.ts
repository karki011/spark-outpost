import { describe, expect, it } from 'vitest';
import { EventType, type RunEvent } from './run-events.ts';
import {
  applySubagentEvent,
  emptySubagentRoster,
  OWN_SUBAGENT_METADATA,
  SUBAGENTS_ACTIVITY,
  subagentSummary,
  waitingOnLabel,
} from './subagents.ts';

const started = (id: string, extra: Partial<RunEvent> = {}): RunEvent =>
  ({
    type: EventType.SUBAGENT_STARTED,
    subagentRunId: id,
    name: `name ${id}`,
    description: `task ${id}`,
    timestamp: 10,
    metadata: OWN_SUBAGENT_METADATA,
    ...extra,
  }) as RunEvent;

const step = (type: 'STEP_STARTED' | 'STEP_FINISHED', stepName: string, id?: string): RunEvent =>
  ({ type, stepName, ...(id ? { subagentRunId: id } : {}) }) as RunEvent;

const wait = (waitingOn: number): RunEvent => ({
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId: SUBAGENTS_ACTIVITY,
  activityType: SUBAGENTS_ACTIVITY,
  content: { waitingOn },
  replace: true,
});

const fold = (events: readonly RunEvent[]) =>
  events.reduce(applySubagentEvent, emptySubagentRoster);

describe('sub-agent roster', () => {
  it('lists each sub-agent with its task, parent and start time', () => {
    const roster = fold([
      started('a'),
      started('b', { parentSubagentRunId: 'a' } as Partial<RunEvent>),
    ]);
    expect(roster.rows).toEqual([
      expect.objectContaining({
        id: 'a',
        name: 'name a',
        task: 'task a',
        parentId: null,
        state: 'working',
        startedAt: 10,
      }),
      expect.objectContaining({ id: 'b', parentId: 'a', state: 'working' }),
    ]);
  });

  it('ignores the sub-agent events of a stored crew turn', () => {
    const crew = {
      type: EventType.SUBAGENT_STARTED,
      subagentRunId: 'run-1',
      name: 'Builder',
    } as RunEvent;
    const roster = fold([crew, step('STEP_STARTED', 'Reading', 'run-1')]);
    expect(roster).toBe(emptySubagentRoster);
  });

  it('shows the latest open step of a sub-agent as its current step', () => {
    const events = [
      started('a'),
      step('STEP_STARTED', 'Read a.ts', 'a'),
      step('STEP_STARTED', 'Read b.ts', 'a'),
      step('STEP_STARTED', 'Thinking'),
    ];
    expect(fold(events).rows[0]!.step).toBe('Read b.ts');
    expect(fold([...events, step('STEP_FINISHED', 'Read b.ts', 'a')]).rows[0]!.step).toBe(
      'Read a.ts',
    );
    const idle = fold([
      ...events,
      step('STEP_FINISHED', 'Read b.ts', 'a'),
      step('STEP_FINISHED', 'Read a.ts', 'a'),
    ]);
    expect(idle.rows[0]!.step).toBeNull();
  });

  it('records how and when a sub-agent ended, once', () => {
    const done = {
      type: EventType.SUBAGENT_FINISHED,
      subagentRunId: 'a',
      outcome: { type: 'success' },
      timestamp: 20,
    } as RunEvent;
    const error = (code: string): RunEvent =>
      ({
        type: EventType.SUBAGENT_ERROR,
        subagentRunId: 'a',
        message: 'x',
        code,
        timestamp: 30,
      }) as RunEvent;
    expect(fold([started('a'), step('STEP_STARTED', 'Read', 'a'), done]).rows[0]).toMatchObject({
      state: 'done',
      step: null,
      endedAt: 20,
    });
    expect(fold([started('a'), done, error('failed')]).rows[0]!.state).toBe('done');
    expect(fold([started('a'), error('failed')]).rows[0]!.state).toBe('failed');
    expect(fold([started('a'), error('cancelled')]).rows[0]!.state).toBe('cancelled');
    expect(fold([started('a'), error('interrupted')]).rows[0]!.state).toBe('cancelled');
  });

  it('follows the waiting count and clears it when the run ends', () => {
    expect(fold([started('a'), wait(1)]).waitingOn).toBe(1);
    expect(fold([started('a'), wait(1), wait(0)]).waitingOn).toBe(0);
    const finished = { type: EventType.RUN_FINISHED, runId: 'r', threadId: 't' } as RunEvent;
    expect(fold([started('a'), wait(1), finished]).waitingOn).toBe(0);
  });

  it('keeps the same roster when an event changes nothing', () => {
    const roster = fold([started('a')]);
    expect(applySubagentEvent(roster, step('STEP_STARTED', 'Thinking'))).toBe(roster);
    expect(applySubagentEvent(roster, wait(0))).toBe(roster);
  });

  it('words the summary and the waiting line', () => {
    expect(subagentSummary([{ state: 'working' }, { state: 'working' }, { state: 'done' }])).toBe(
      '3 sub-agents · 2 working, 1 done',
    );
    expect(subagentSummary([{ state: 'failed' }])).toBe('1 sub-agent · 1 failed');
    expect(waitingOnLabel(2)).toBe('Waiting on 2 sub-agents');
    expect(waitingOnLabel(1)).toBe('Waiting on 1 sub-agent');
  });
});
