import { describe, expect, it } from 'vitest';
import type { ScheduleSlot, WorkflowRun } from '@spark-outpost/contracts';
import {
  defaultSchedule,
  editSchedule,
  estimateLine,
  historyRows,
  nextRunLines,
  scheduleProblem,
  scheduleSummary,
  toggleDay,
} from './schedule-model.ts';

const monday = new Date(2026, 10, 16, 10, 40);
const base = defaultSchedule(monday);
const halfHours = editSchedule(
  base,
  { every: 30, unit: 'minutes', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' },
  monday,
);

function run(extra: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workflowId: 'pre-pr-review',
    workflowName: 'Pre-PR review',
    kind: 'run',
    source: 'schedule',
    status: 'succeeded',
    conversationId: null,
    runId: null,
    stoppedBy: null,
    steps: [],
    spend: { tokens: 0, costUsd: null, costSource: null },
    startedAt: new Date(2026, 10, 16, 10, 30).toISOString(),
    finishedAt: new Date(2026, 10, 16, 10, 32, 5).toISOString(),
    ...extra,
  };
}

function slot(extra: Partial<ScheduleSlot>): ScheduleSlot {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    slotAt: new Date(2026, 10, 16, 9, 30).toISOString(),
    lastSlotAt: new Date(2026, 10, 16, 9, 30).toISOString(),
    state: 'skipped',
    reason: 'previous_running',
    detail: null,
    source: 'schedule',
    workflowRunId: null,
    releasedAt: null,
    ...extra,
  };
}

describe('a schedule draft', () => {
  it('starts off, daily at nine, anchored today', () => {
    expect(base).toMatchObject({
      enabled: false,
      every: 1,
      unit: 'days',
      from: '09:00',
      to: null,
      anchor: '2026-11-16',
      missed: 'run_once',
    });
  });

  it('drops the end of the hours for days and weeks and re-anchors when the pace changes', () => {
    const later = new Date(2026, 10, 20, 8, 0);
    const weekly = editSchedule(halfHours, { unit: 'weeks', every: 2 }, later);
    expect(weekly).toMatchObject({ to: null, anchor: '2026-11-20' });
    expect(editSchedule(halfHours, { message: 'Hi' }, later).anchor).toBe('2026-11-16');
  });

  it('treats all seven days as every day', () => {
    expect(toggleDay([1, 2, 3, 4, 5, 6], 0)).toEqual([]);
    expect(toggleDay([1, 3], 3)).toEqual([1]);
    expect(toggleDay([5], 1)).toEqual([1, 5]);
  });

  it('names what stops a save', () => {
    expect(scheduleProblem(halfHours)).toBeNull();
    expect(scheduleProblem({ ...halfHours, every: 0 })).toContain('1 to 1000');
    expect(scheduleProblem({ ...halfHours, to: '08:00' })).toContain('after the start');
    expect(scheduleProblem({ ...base, from: '09:00' })).toBeNull();
  });
});

describe('what the tab says about a schedule', () => {
  it('summarises it for the chip in the clock of the Mac', () => {
    expect(scheduleSummary(halfHours, 'h23')).toBe('Every 30 min · weekdays 9:00–18:00');
    expect(scheduleSummary(halfHours, 'h12')).toBe('Every 30 min · weekdays 9:00 AM–6:00 PM');
    expect(scheduleSummary(base, 'h23')).toBe('Every day at 9:00');
    expect(scheduleSummary({ ...base, unit: 'weeks', every: 2, days: [1, 4] }, 'h23')).toBe(
      'Every 2 weeks · Mon, Thu at 9:00',
    );
    expect(scheduleSummary({ ...halfHours, days: [], from: '00:00', to: null }, 'h23')).toBe(
      'Every 30 min',
    );
  });

  it('lists the next three runs', () => {
    expect(nextRunLines(halfHours, monday, 'h23')).toEqual([
      'Today · 11:00',
      'Today · 11:30',
      'Today · 12:00',
    ]);
    const friday = new Date(2026, 10, 20, 17, 45);
    expect(nextRunLines(halfHours, friday, 'h12')[0]).toBe('Today · 6:00 PM');
    expect(nextRunLines(halfHours, friday, 'h12')[1]).toMatch(/^Mon.* · 9:00 AM$/);
    expect(nextRunLines({ ...halfHours, every: 0 }, monday, 'h23')).toEqual([]);
  });

  it('estimates runs and cost a day from the last run', () => {
    expect(estimateLine(halfHours, null)).toBe('About 19 runs a day');
    expect(estimateLine(halfHours, 0.2)).toBe(
      'About 19 runs a day · about $3.80 a day at the last run’s cost',
    );
    expect(estimateLine(base, 0.2)).toBe(
      'One run a day · about $0.20 a run at the last run’s cost',
    );
    expect(estimateLine({ ...base, unit: 'weeks', every: 2, days: [1] }, null)).toBe(
      'One run every 2 weeks, on the days picked',
    );
  });
});

describe('recent runs', () => {
  it('merges runs with skipped and held slots, newest first, and says how each started', () => {
    const rows = historyRows(
      [
        run({}),
        run({
          id: '00000000-0000-4000-8000-000000000003',
          source: 'manual',
          status: 'failed',
          stoppedBy: 'types',
          steps: [
            {
              stepId: 'types',
              sparkId: '00000000-0000-4000-8000-000000000009',
              dependsOn: [],
              state: 'failed',
              runId: null,
              note: null,
              startedAt: null,
              finishedAt: null,
            },
          ],
          startedAt: new Date(2026, 10, 16, 9, 42).toISOString(),
          finishedAt: null,
        }),
        run({ id: '00000000-0000-4000-8000-000000000004', kind: 'test' }),
      ],
      [
        slot({}),
        slot({
          id: '00000000-0000-4000-8000-000000000005',
          state: 'held',
          reason: 'paused',
          slotAt: new Date(2026, 10, 15, 17, 0).toISOString(),
          lastSlotAt: new Date(2026, 10, 15, 17, 30).toISOString(),
        }),
        slot({ id: '00000000-0000-4000-8000-000000000006', state: 'started', reason: null }),
        slot({
          id: '00000000-0000-4000-8000-000000000007',
          state: 'not_started',
          reason: 'problem',
          detail: 'lint uses a Spark that no longer exists.',
          source: 'catch_up',
          slotAt: new Date(2026, 10, 14, 9, 0).toISOString(),
          lastSlotAt: new Date(2026, 10, 14, 9, 0).toISOString(),
        }),
      ],
      monday,
      'h23',
    );
    expect(
      rows.map(({ when, how, state, tone, note, took }) => [when, how, state, tone, note, took]),
    ).toEqual([
      ['Today · 10:30', 'Scheduled', 'Done', 'succeeded', '', '2m 05s'],
      ['Today · 9:42', 'Run now', 'Failed', 'failed', 'types stopped the workflow', ''],
      ['Today · 9:30', 'Scheduled', 'Skipped', 'quiet', 'The previous run was still going', ''],
      ['Yesterday · 17:00 to 17:30', 'Scheduled', 'Held', 'quiet', 'Spark was paused', ''],
      [
        expect.stringMatching(/^Sat.* · 9:00$/),
        'Caught up',
        'Not started',
        'failed',
        'The workflow has a problem: lint uses a Spark that no longer exists.',
        '',
      ],
    ]);
  });
});
