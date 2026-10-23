import { describe, expect, it } from 'vitest';
import type { PlanEntry } from '@spark-outpost/contracts';
import {
  currentTodo,
  finishedText,
  previousTodo,
  shownTodo,
  todoRows,
  turnChanges,
  turnTodo,
} from './todo-model.ts';

const entry = (content: string, status: PlanEntry['status']): PlanEntry => ({
  content,
  priority: 'medium',
  status,
});

const list = [
  entry('Find the divider', 'completed'),
  entry('Compare by day', 'completed'),
  entry('Update the test', 'in_progress'),
  entry('Run the tests', 'pending'),
];

describe("a turn's to-do", () => {
  it('prefers the streamed list and falls back to the one stored with the run', () => {
    const stored = [entry('Stored', 'completed')];
    expect(shownTodo(list, stored)).toBe(list);
    expect(shownTodo(null, stored)).toBe(stored);
    expect(shownTodo(null, null)).toEqual([]);
  });

  it('spins only the current item while the turn is live', () => {
    expect(todoRows(list, true).map((row) => row.state)).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
    expect(todoRows(list, false)[2]!.state).toBe('pending');
  });

  it('sums up a finished list, naming what was left', () => {
    expect(finishedText(list)).toBe('2 of 4 done · 2 not finished');
    const all = list.map((item) => ({ ...item, status: 'completed' as const }));
    expect(finishedText(all)).toBe('4 of 4 done');
  });

  it('names the item the agent is on', () => {
    expect(currentTodo(list)).toBe('Update the test');
    expect(currentTodo([entry('Done', 'completed')])).toBeNull();
  });
});

describe("a later turn's own items", () => {
  const before = [
    entry('Find the divider', 'completed'),
    entry('Compare by day', 'completed'),
    entry('Update the test', 'pending'),
  ];

  it('keeps every item when nothing came before', () => {
    expect(turnChanges([], list).map((item) => item.change)).toEqual([
      'added',
      'added',
      'added',
      'added',
    ]);
  });

  it('shows only items added or changed since the previous turn ended', () => {
    const after = [
      ...before.slice(0, 2),
      entry('Update the test', 'completed'),
      entry('Run the tests', 'completed'),
    ];
    expect(turnChanges(before, after)).toEqual([
      { entry: entry('Update the test', 'completed'), change: 'changed' },
      { entry: entry('Run the tests', 'completed'), change: 'added' },
    ]);
  });

  it('counts an item the agent only reworded while working as changed, not new', () => {
    const working = [...before.slice(0, 2), entry('Updating the test', 'in_progress')];
    expect(turnChanges(before, working)).toEqual([
      { entry: entry('Updating the test', 'in_progress'), change: 'changed' },
    ]);
    const reworded = [...before.slice(0, 2), entry('Updating the test', 'in_progress')];
    expect(turnChanges(reworded, before)).toEqual([
      { entry: entry('Update the test', 'pending'), change: 'changed' },
    ]);
  });

  it('shows nothing when the agent only sent the same list again', () => {
    expect(turnChanges(before, before)).toEqual([]);
  });

  it("compares with the latest earlier run's list, skipping runs without one", () => {
    const runs = [
      { id: 'a', createdAt: '2026-10-22T10:00:00Z', todo: before },
      { id: 'b', createdAt: '2026-10-22T10:05:00Z', todo: null },
      { id: 'child', createdAt: '2026-10-22T10:06:00Z', parentRunId: 'b', todo: list },
      { id: 'c', createdAt: '2026-10-22T10:10:00Z', todo: list },
    ];
    expect(previousTodo(runs, 'c')).toBe(before);
    expect(previousTodo(runs, 'a')).toEqual([]);
    expect(turnTodo(runs, 'c', list).map((item) => item.content)).toEqual([
      'Update the test',
      'Run the tests',
    ]);
  });

  it("keeps a helper's whole list, never compared with an earlier turn", () => {
    const runs = [
      { id: 'a', createdAt: '2026-10-22T10:00:00Z', todo: list },
      { id: 'b', createdAt: '2026-10-22T10:05:00Z', todo: null },
      { id: 'helper', createdAt: '2026-10-22T10:06:00Z', parentRunId: 'b', todo: list },
    ];
    expect(previousTodo(runs, 'helper')).toEqual([]);
    expect(turnTodo(runs, 'helper', list)).toEqual(list);
  });
});
