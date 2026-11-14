import { describe, expect, it } from 'vitest';
import { decideDue, scheduleSlotReasonLine, scheduleUpdateLine } from './crew-schedule-slots.ts';
import { workflowScheduleSchema } from './crew-schedule.ts';

const at = (hour: number, minute: number) => new Date(2026, 10, 16, hour, minute);
const schedule = workflowScheduleSchema.parse({
  enabled: true,
  every: 30,
  unit: 'minutes',
  from: '09:00',
  to: '18:00',
  anchor: '2026-11-01',
  projectId: null,
});
const due = (extra: Partial<Parameters<typeof decideDue>[0]>) =>
  decideDue({
    schedule,
    lastChecked: at(9, 10),
    now: at(9, 20),
    paused: false,
    heldSince: null,
    ...extra,
  });

describe('what a schedule check decides', () => {
  it('does nothing between slots', () => {
    expect(due({})).toEqual({ action: { kind: 'none' }, release: false });
  });

  it('starts the slot that just came due', () => {
    expect(due({ now: at(9, 31) }).action).toEqual({
      kind: 'start',
      source: 'schedule',
      slotAt: at(9, 30),
    });
  });

  it('starts one catch-up run after a gap, or skips it', () => {
    expect(due({ now: at(14, 12) }).action).toEqual({
      kind: 'start',
      source: 'catch_up',
      slotAt: at(9, 30),
    });
    expect(due({ now: at(14, 12), schedule: { ...schedule, missed: 'skip' } }).action).toEqual({
      kind: 'skip_missed',
      slotAt: at(9, 30),
    });
  });

  it('prefers the slot due now over a catch-up after a gap', () => {
    expect(due({ now: at(14, 2) }).action).toEqual({
      kind: 'start',
      source: 'schedule',
      slotAt: at(14, 0),
    });
  });

  it('holds while paused and owes one run after', () => {
    expect(due({ now: at(9, 31), paused: true })).toEqual({
      action: { kind: 'hold', slotAt: at(9, 30), lastSlotAt: at(9, 30) },
      release: false,
    });
    expect(due({ lastChecked: at(9, 31), now: at(9, 40), heldSince: at(9, 30) })).toEqual({
      action: { kind: 'start', source: 'catch_up', slotAt: at(9, 30) },
      release: true,
    });
    expect(
      due({
        lastChecked: at(9, 31),
        now: at(9, 40),
        heldSince: at(9, 30),
        schedule: { ...schedule, missed: 'skip' },
      }),
    ).toEqual({ action: { kind: 'none' }, release: true });
  });
});

describe('schedule lines', () => {
  it('groups a day of runs and singles out failures', () => {
    const update = { workflowId: 'pre-pr-review', name: 'Pre-PR review', runsToday: 12 };
    expect(scheduleUpdateLine({ ...update, failedToday: 1 })).toBe(
      'Pre-PR review: 12 runs today, 1 failed',
    );
    expect(scheduleUpdateLine({ ...update, runsToday: 1, failedToday: 0 })).toBe(
      'Pre-PR review: 1 run today',
    );
  });

  it('says why a slot did not run', () => {
    expect(scheduleSlotReasonLine({ reason: 'paused', detail: null })).toBe('Spark was paused');
    expect(scheduleSlotReasonLine({ reason: 'error', detail: 'No agent is connected.' })).toBe(
      'The run could not start: No agent is connected.',
    );
  });
});
