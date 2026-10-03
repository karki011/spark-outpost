import { describe, expect, it } from 'vitest';
import type { TaskListItem, TaskOverview } from '@spark-outpost/contracts';
import { showsTaskCard } from './task-card-shown.ts';

function task(items: TaskListItem[], waiting = 0): TaskOverview {
  return {
    items,
    summary: { done: items.length, total: items.length, waiting, text: '' },
  } as TaskOverview;
}

const understood: TaskListItem = { id: 'understood', label: 'Understood', state: 'done' };
const reply = (id: string): TaskListItem => ({ id: `run:${id}`, label: 'Replied', state: 'done' });

describe('showsTaskCard', () => {
  it('hides the card when the task is only replies to questions', () => {
    expect(showsTaskCard(task([understood, reply('a'), reply('b')]))).toBe(false);
  });

  it('shows it for plans, checks, pull requests and anything waiting', () => {
    const planned = { id: 'planned', label: 'Made a plan', state: 'done' } as const;
    const pr = { id: 'pr:https://x/1', label: 'Opened #1', state: 'done' } as const;
    const check = { id: 'check:1', label: 'Tests', state: 'active' } as const;
    expect(showsTaskCard(task([understood, planned, reply('a')]))).toBe(true);
    expect(showsTaskCard(task([understood, reply('a'), pr]))).toBe(true);
    expect(showsTaskCard(task([understood, check, reply('a')]))).toBe(true);
    expect(showsTaskCard(task([understood, reply('a')], 1))).toBe(true);
  });
});
