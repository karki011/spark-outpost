import { describe, expect, it } from 'vitest';
import type { PlanEntry } from './artifacts.ts';
import {
  recordedItems,
  taskSummary,
  todoItems,
  waitingApprovalId,
  type TaskListEvent,
  type TaskListRun,
} from './tasks.ts';

const RUN_A = '00000000-0000-4000-8000-00000000000a';

const run = (overrides: Partial<TaskListRun> = {}): TaskListRun => ({
  id: RUN_A,
  provider: 'codex',
  status: 'running',
  ...overrides,
});

const entries: PlanEntry[] = [
  { content: 'Read the code', priority: 'high', status: 'completed' },
  { content: 'Fix the divider', priority: 'medium', status: 'in_progress' },
  { content: 'Add a test', priority: 'low', status: 'pending' },
];

const approval: TaskListEvent = {
  id: 'apr1',
  kind: 'waiting',
  label: 'Waiting for you: run pnpm test',
  state: 'waiting',
  command: true,
};

describe('todoItems', () => {
  it("lists only the agent's own entries, with the current one active while a run is live", () => {
    const items = todoItems({ entries }, [run()]);
    expect(items.map((item) => [item.id, item.label, item.state])).toEqual([
      ['todo:0', 'Read the code', 'done'],
      ['todo:1', 'Fix the divider', 'active'],
      ['todo:2', 'Add a test', 'pending'],
    ]);
  });

  it('shows an unfinished entry as not started once no run is live', () => {
    for (const status of ['succeeded', 'cancelled', 'failed'] as const) {
      const items = todoItems({ entries }, [run({ status })]);
      expect(items[1]!.state).toBe('pending');
    }
  });

  it('keeps an entry the agent marked failed as failed', () => {
    const failed: PlanEntry = { content: 'Deploy', priority: 'medium', status: 'failed' };
    expect(todoItems({ entries: [failed] }, [run()])[0]!.state).toBe('failed');
  });

  it('is empty when the agent sent no list', () => {
    expect(todoItems(null, [run()])).toEqual([]);
    expect(todoItems({ entries: [] }, [run()])).toEqual([]);
  });
});

describe('recordedItems', () => {
  it('keeps approvals Spark handled, with their approval id', () => {
    const [item] = recordedItems([approval]);
    expect(item).toMatchObject({ id: 'waiting:apr1', state: 'waiting', command: true });
    expect(waitingApprovalId(item!)).toBe('apr1');
    expect(waitingApprovalId({ id: 'todo:0' })).toBeNull();
  });
});

describe('taskSummary', () => {
  it('counts only to-do entries and names the working agent', () => {
    const runs = [run()];
    expect(taskSummary(todoItems({ entries }, runs), [], runs)).toEqual({
      done: 1,
      total: 3,
      waiting: 0,
      text: '1 of 3 done · Codex working',
    });
  });

  it('puts waiting for you first and leaves approvals out of the count', () => {
    const runs = [run({ status: 'awaiting_approval' })];
    const summary = taskSummary(todoItems({ entries }, runs), recordedItems([approval]), runs);
    expect(summary).toMatchObject({ done: 1, total: 3, waiting: 1 });
    expect(summary.text).toBe('1 of 3 done · Waiting for you');
  });

  it('reports a stopped run and omits the status once it finished', () => {
    const items = todoItems({ entries }, []);
    expect(taskSummary(items, [], [run({ status: 'cancelled' })]).text).toBe(
      '1 of 3 done · Stopped',
    );
    expect(taskSummary(items, [], [run({ status: 'succeeded' })]).text).toBe('1 of 3 done');
  });

  it('has no count when there is no list', () => {
    expect(taskSummary([], [], [run({ status: 'succeeded' })])).toEqual({
      done: 0,
      total: 0,
      waiting: 0,
      text: '',
    });
  });
});
