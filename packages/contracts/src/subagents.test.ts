import { describe, expect, it } from 'vitest';
import { EventType, type RunEvent } from './run-events.ts';
import { SUBAGENT_REPORT, subagentUsageParts } from './subagent-report.ts';
import {
  agentsWorkingLabel,
  applySubagentEvent,
  emptySubagentRoster,
  rosterCounts,
  OWN_SUBAGENT_METADATA,
  SUBAGENTS_ACTIVITY,
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

  it("keeps a sub-agent's steps in order with what it changed, ran, used and said", () => {
    const report = (value: Record<string, unknown>): RunEvent => ({
      type: EventType.CUSTOM,
      name: SUBAGENT_REPORT,
      value: { id: 'a', ...value },
    });
    const done = {
      type: EventType.SUBAGENT_FINISHED,
      subagentRunId: 'a',
      outcome: { type: 'success' },
    } as RunEvent;
    const row = fold([
      started('a'),
      step('STEP_STARTED', 'Read a.ts', 'a'),
      step('STEP_FINISHED', 'Read a.ts', 'a'),
      step('STEP_STARTED', 'Edit a.ts', 'a'),
      report({ files: ['/work/a.ts'] }),
      report({ files: ['/work/a.ts', '/work/b.ts'], commands: ['pnpm test'] }),
      report({ usage: { tokens: 1200 } }),
      done,
      report({ usage: { tokens: 3400, toolUses: 7 }, message: 'All moved.', summary: 'Moved' }),
      report({ id: 'ghost', message: 'ignored' }),
    ]).rows[0]!;
    expect(row).toMatchObject({
      steps: [
        { name: 'Read a.ts', done: true },
        { name: 'Edit a.ts', done: false },
      ],
      files: ['/work/a.ts', '/work/b.ts'],
      commands: ['pnpm test'],
      usage: { tokens: 3400, toolUses: 7 },
      message: 'All moved.',
    });
    expect(row.summary).toBeUndefined();
    const pointed = fold([
      started('a'),
      report({ message: 'Report.' }),
      report({ summary: 'Read it there.' }),
    ]);
    expect(pointed.rows[0]!.summary).toBeUndefined();
    expect(fold([started('a'), report({ summary: 'Found 4' })]).rows[0]!.summary).toBe('Found 4');
    expect(subagentUsageParts(row, 41_000)).toEqual(['2 steps', '3.4k tokens', '41s']);
    expect(
      subagentUsageParts(
        {
          steps: [],
          usage: {
            turns: 2,
            tokens: 34_000,
            costUsd: 0.04,
            durationMs: 95_000,
            model: 'gpt-6-luna',
          },
        },
        null,
      ),
    ).toEqual(['2 turns', '34k tokens', '$0.04', '1m 35s', 'gpt-6-luna']);
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

  it('words the waiting line', () => {
    expect(waitingOnLabel(2)).toBe('Waiting on 2 sub-agents');
    expect(waitingOnLabel(1)).toBe('Waiting on 1 sub-agent');
    expect(waitingOnLabel(2, { agents: 2, tasks: 0, names: [] })).toBe(
      'Waiting on 2 background agents',
    );
    expect(waitingOnLabel(2, { agents: 1, tasks: 1, names: [] })).toBe(
      'Waiting on 1 background agent and 1 background task',
    );
  });

  it('shows a resumed generation as the same sub-agent working again', () => {
    const roster = fold([
      started('a'),
      { type: EventType.SUBAGENT_FINISHED, subagentRunId: 'a', outcome: { type: 'success' } },
      started('a:generation:2', { name: 'again', description: '<task-notification>' }),
      step('STEP_STARTED', 'Read', 'a:generation:2'),
    ] as RunEvent[]);
    expect(roster.rows).toEqual([
      expect.objectContaining({
        id: 'a',
        name: 'name a',
        task: 'task a',
        state: 'working',
        step: 'Read',
      }),
    ]);
    const done = applySubagentEvent(roster, {
      type: EventType.SUBAGENT_FINISHED,
      subagentRunId: 'a:generation:2',
      outcome: { type: 'success' },
    } as RunEvent);
    expect(done.rows[0]).toMatchObject({ state: 'done' });
  });

  it('keeps the background wait until the run ends', () => {
    const background = { agents: 1, tasks: 0, names: ['Schema'] };
    const waiting = fold([
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: SUBAGENTS_ACTIVITY,
        activityType: SUBAGENTS_ACTIVITY,
        content: { waitingOn: 1, background },
        replace: true,
      } as RunEvent,
    ]);
    expect(waiting).toMatchObject({ waitingOn: 1, background });
    expect(applySubagentEvent(waiting, { type: EventType.RUN_FINISHED } as RunEvent)).toMatchObject(
      { waitingOn: 0, background: null },
    );
  });

  it('counts the working agents out of all of them', () => {
    const roster = fold([
      started('a'),
      started('b'),
      { type: EventType.SUBAGENT_FINISHED, subagentRunId: 'a', timestamp: 20 } as RunEvent,
    ]);
    expect(rosterCounts(roster)).toEqual({ working: 1, total: 2 });
    expect(agentsWorkingLabel(1, 2)).toBe('1 of 2 agents working');
    expect(agentsWorkingLabel(1, 1)).toBe('1 of 1 agent working');
  });

  it('keeps one usage figure when the end is reported twice', () => {
    const report = {
      type: EventType.CUSTOM,
      name: SUBAGENT_REPORT,
      value: { id: 'a', usage: { tokens: 3400, durationMs: 41_000 } },
    } as RunEvent;
    const roster = fold([started('a'), report, report]);
    expect(roster.rows[0]?.usage).toEqual({ tokens: 3400, durationMs: 41_000 });
  });
});
