import { describe, expect, it } from 'vitest';
import type { PlanEntry } from '@spark-outpost/contracts';
import { currentTodo, finishedText, shownTodo, todoRows } from './todo-model.ts';

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
