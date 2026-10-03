import { describe, expect, it } from 'vitest';
import type { PlanEntry } from './artifacts.ts';
import {
  taskList,
  taskSummary,
  waitingApprovalId,
  type TaskListRun,
  type TaskListTask,
} from './tasks.ts';

const RUN_A = '00000000-0000-4000-8000-00000000000a';
const RUN_B = '00000000-0000-4000-8000-00000000000b';

const run = (overrides: Partial<TaskListRun> = {}): TaskListRun => ({
  id: RUN_A,
  provider: 'codex',
  model: 'gpt-5',
  effort: 'medium',
  status: 'running',
  tokens: null,
  costUsd: null,
  request: 'Fix the divider',
  ...overrides,
});

const openTask: TaskListTask = { status: 'open', links: [] };

const entries: PlanEntry[] = [
  { content: 'Read the code', priority: 'high', status: 'completed' },
  { content: 'Fix the divider', priority: 'medium', status: 'in_progress' },
  { content: 'Add a test', priority: 'low', status: 'pending' },
];

describe('taskList', () => {
  it('lists the harness stages, the plan and the run', () => {
    const items = taskList(openTask, [run()], [], {
      version: 2,
      entries,
      sourceRunId: RUN_A,
    });
    expect(items.map((item) => [item.id, item.state])).toEqual([
      ['understood', 'done'],
      ['planned', 'done'],
      ['plan:0', 'done'],
      ['plan:1', 'active'],
      ['plan:2', 'pending'],
      [`run:${RUN_A}`, 'active'],
    ]);
    expect(items[1]).toMatchObject({
      detail: 'plan v2',
      agent: { provider: 'codex', model: 'gpt-5', effort: 'medium' },
    });
  });

  it('shows an unfinished step as failed once the run stopped', () => {
    const items = taskList(openTask, [run({ status: 'cancelled' })], [], {
      version: 1,
      entries,
      sourceRunId: RUN_A,
    });
    expect(items.find((item) => item.id === 'plan:1')?.state).toBe('failed');
    expect(items.find((item) => item.id === 'plan:2')?.state).toBe('pending');
  });

  it('keeps the request active while the first run is queued', () => {
    expect(taskList(openTask, [run({ status: 'queued' })], [], null)[0]?.state).toBe('active');
  });

  it('labels follow-ups with their request and carries tokens and cost', () => {
    const items = taskList(
      openTask,
      [
        run({ status: 'succeeded', tokens: 1200, costUsd: 0.004 }),
        run({ id: RUN_B, request: 'Also add a test for midnight', status: 'running' }),
      ],
      [],
      null,
    );
    expect(items.map((item) => item.label)).toEqual([
      'Understood the request',
      'Worked on the request',
      'Follow-up: Also add a test for midnight',
    ]);
    expect(items[1]).toMatchObject({ tokens: 1200, costUsd: 0.004, detail: 'Replied' });
  });

  it('adds waiting items from harness events and a done item per pull request it opened', () => {
    const items = taskList(
      {
        status: 'open',
        links: [
          { kind: 'pr', url: 'https://github.com/a/b/pull/7', title: 'a/b#7', source: 'ship' },
          {
            kind: 'pr',
            url: 'https://github.com/a/b/pull/2',
            title: 'a/b#2',
            source: 'agent_text',
          },
          { kind: 'link', url: 'https://example.com', title: null, source: 'user' },
        ],
      },
      [run()],
      [
        {
          id: 'apr1',
          kind: 'waiting',
          label: 'Waiting for you: run pnpm test',
          state: 'waiting',
          runId: RUN_A,
        },
      ],
      null,
    );
    expect(items.map((item) => [item.id, item.state])).toEqual([
      ['understood', 'done'],
      ['waiting:apr1', 'waiting'],
      [`run:${RUN_A}`, 'active'],
      ['pr:https://github.com/a/b/pull/7', 'done'],
    ]);
    expect(items.at(-1)?.label).toBe('Opened a/b#7');
    expect(items[1]).toMatchObject({ runId: RUN_A });
    expect(waitingApprovalId(items[1]!)).toBe('apr1');
    expect(waitingApprovalId(items[2]!)).toBeNull();
  });

  it('names the crew member and its run on each agent item, replacing started plan steps', () => {
    const architect = run({ id: RUN_A, role: 'architect', status: 'succeeded' });
    const builder = run({
      id: RUN_B,
      role: 'builder',
      name: 'Builder 2',
      label: 'Builder 2',
      step: 'Fix the divider',
    });
    const runs = [architect, builder];
    const items = taskList(openTask, runs, [], { version: 1, entries, sourceRunId: RUN_A });
    expect(items.find((item) => item.id === 'planned')).toMatchObject({
      role: 'architect',
      runId: RUN_A,
    });
    expect(items.map((item) => item.id)).toEqual([
      'understood',
      'planned',
      'plan:0',
      'plan:2',
      `run:${RUN_A}`,
      `run:${RUN_B}`,
    ]);
    expect(items.at(-1)).toMatchObject({
      role: 'builder',
      runId: RUN_B,
      label: 'Builder 2: Fix the divider',
    });
    expect(items.find((item) => item.id === 'plan:2')?.role).toBeUndefined();
    expect(taskSummary(items, runs).text).toBe('4 of 6 done · Builder 2 working');
  });

  it('keeps the Architect as the planner once Builders record step progress', () => {
    const architect = run({ id: RUN_A, role: 'architect', status: 'succeeded' });
    const builder = run({
      id: RUN_B,
      role: 'builder',
      status: 'failed',
      step: 'Fix the divider\nAdd a test',
    });
    const progress: PlanEntry[] = [
      { content: 'Read the code', priority: 'high', status: 'completed' },
      { content: 'Fix the divider', priority: 'medium', status: 'failed' },
      { content: 'Add a test', priority: 'low', status: 'failed' },
    ];
    const items = taskList(openTask, [architect, builder], [], {
      version: 4,
      entries: progress,
      sourceRunId: RUN_B,
    });
    expect(items.find((item) => item.id === 'planned')).toMatchObject({ runId: RUN_A });
    expect(items.map((item) => [item.id, item.state])).toEqual([
      ['understood', 'done'],
      ['planned', 'done'],
      ['plan:0', 'done'],
      [`run:${RUN_A}`, 'done'],
      [`run:${RUN_B}`, 'failed'],
    ]);
  });

  it('shows a failed plan entry as failed', () => {
    const failed: PlanEntry[] = [{ content: 'Fix', priority: 'medium', status: 'failed' }];
    const items = taskList(openTask, [run({ status: 'succeeded' })], [], {
      version: 2,
      entries: failed,
      sourceRunId: null,
    });
    expect(items.find((item) => item.id === 'plan:0')?.state).toBe('failed');
  });
});

describe('taskSummary', () => {
  it('counts done items and names the working agent', () => {
    const runs = [run()];
    const items = taskList(openTask, runs, [], { version: 1, entries, sourceRunId: RUN_A });
    expect(taskSummary(items, runs)).toEqual({
      done: 3,
      total: 6,
      waiting: 0,
      text: '3 of 6 done · Codex working',
    });
  });

  it('puts waiting for you first and reports a stopped run', () => {
    const waiting = [{ id: 'x', label: 'Approve', state: 'waiting' as const }];
    expect(taskSummary(waiting, [run()]).text).toBe('0 of 1 done · Waiting for you');
    const stopped = [run({ status: 'cancelled' })];
    expect(taskSummary(taskList(openTask, stopped, [], null), stopped).text).toBe(
      '1 of 2 done · Stopped',
    );
  });

  it('pins a run waiting on an approval as waiting for you', () => {
    const runs = [run({ status: 'awaiting_approval' })];
    const items = taskList(openTask, runs, [], { version: 1, entries, sourceRunId: RUN_A });
    expect(items.at(-1)).toMatchObject({ state: 'waiting', detail: 'Waiting for you' });
    expect(items.find((item) => item.id === 'plan:1')?.state).toBe('active');
    expect(taskSummary(items, runs).text).toBe('3 of 6 done · Waiting for you');
  });

  it('omits the status once everything finished', () => {
    const runs = [run({ status: 'succeeded' })];
    expect(taskSummary(taskList(openTask, runs, [], null), runs).text).toBe('2 of 2 done');
  });
});
