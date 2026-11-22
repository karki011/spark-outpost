import { describe, expect, it } from 'vitest';
import type {
  PublishHold,
  ScheduleSlot,
  TriggerEvent,
  WorkflowRun,
} from '@spark-outpost/contracts';
import { activityRows } from './activity-model.ts';

const now = new Date(2026, 10, 16, 10, 40);
const at = (hour: number, minute: number) => new Date(2026, 10, 16, hour, minute).toISOString();
const CHAT = '00000000-0000-4000-8000-0000000000c1';

function run(extra: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workflowId: 'review',
    workflowName: 'Review',
    kind: 'run',
    source: 'manual',
    status: 'succeeded',
    conversationId: null,
    pull: null,
    runId: null,
    stoppedBy: null,
    steps: [],
    spend: { tokens: 0, costUsd: null, costSource: null },
    startedAt: at(10, 30),
    finishedAt: at(10, 32),
    ...extra,
  };
}

const skippedSlot: ScheduleSlot = {
  id: '00000000-0000-4000-8000-000000000002',
  slotAt: at(9, 30),
  lastSlotAt: at(9, 30),
  state: 'skipped',
  reason: 'previous_running',
  detail: null,
  source: 'schedule',
  workflowRunId: null,
  releasedAt: null,
};

function event(extra: Partial<TriggerEvent>): TriggerEvent {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    kind: 'pull_request',
    conversationId: CHAT,
    chatTitle: 'Fix the divider',
    state: 'skipped',
    reason: 'unchanged',
    detail: null,
    dueAt: at(10, 0),
    workflowRunId: null,
    updatedAt: at(10, 1),
    ...extra,
  };
}

function hold(extra: Partial<PublishHold>): PublishHold {
  return {
    id: '00000000-0000-4000-8000-000000000004',
    conversationId: CHAT,
    chatTitle: 'Fix the divider',
    workflowId: 'review',
    findings: 2,
    finished: true,
    state: 'open',
    createdAt: at(8, 0),
    ...extra,
  };
}

describe('activityRows', () => {
  it('puts open holds first, then runs, slots and triggers newest first, with where each started', () => {
    const rows = activityRows(
      {
        runs: [
          run({}),
          run({
            id: '00000000-0000-4000-8000-000000000005',
            source: 'trigger',
            pull: '#327',
            startedAt: at(9, 0),
            finishedAt: at(9, 1),
          }),
          run({ id: '00000000-0000-4000-8000-000000000006', kind: 'test' }),
        ],
        slots: [skippedSlot],
        events: [
          event({}),
          event({
            id: '00000000-0000-4000-8000-000000000007',
            state: 'started',
            reason: null,
            workflowRunId: '00000000-0000-4000-8000-000000000005',
          }),
        ],
        holds: [hold({}), hold({ id: '00000000-0000-4000-8000-000000000008', state: 'released' })],
      },
      now,
      'h23',
    );
    expect(rows.map(({ how, state, note }) => [how, state, note])).toEqual([
      ['Before publish', 'Held publish', 'Fix the divider · 2 Critical or High findings'],
      ['Run now', 'Done', ''],
      [
        'Triggered · Pull request',
        'Skipped',
        'Fix the divider · Nothing changed since the last run',
      ],
      ['Scheduled', 'Skipped', 'The previous run was still going'],
      ['Triggered · #327', 'Done', ''],
    ]);
    expect(rows.map((row) => [row.runId !== null, row.holdId !== null])).toEqual([
      [false, true],
      [true, false],
      [false, false],
      [false, false],
      [true, false],
    ]);
  });
});
