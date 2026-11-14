import { describe, expect, it } from 'vitest';
import {
  missedRun,
  nextRuns,
  runsPerDay,
  workflowScheduleSchema,
  type ScheduleTiming,
} from './crew-schedule.ts';

function timing(rest: Partial<ScheduleTiming>): ScheduleTiming {
  return {
    every: 1,
    unit: 'days',
    days: [],
    from: '09:00',
    to: null,
    anchor: '2026-11-09',
    ...rest,
  };
}

function stamps(runs: readonly Date[]): string[] {
  return runs.map(
    (run) =>
      `${run.getMonth() + 1}/${run.getDate()} ${String(run.getHours()).padStart(2, '0')}:${String(run.getMinutes()).padStart(2, '0')}`,
  );
}

const halfHourly = timing({ every: 30, unit: 'minutes', days: [1, 2, 3, 4, 5], to: '18:00' });

describe('nextRuns', () => {
  it('runs every 30 minutes inside the window on chosen days', () => {
    const thursday = new Date(2026, 10, 12, 10, 40);
    expect(stamps(nextRuns(halfHourly, thursday, 3))).toEqual([
      '11/12 11:00',
      '11/12 11:30',
      '11/12 12:00',
    ]);
  });

  it('moves to the next allowed day after the window closes', () => {
    const fridayEvening = new Date(2026, 10, 13, 18, 0);
    expect(stamps(nextRuns(halfHourly, fridayEvening, 2))).toEqual(['11/16 09:00', '11/16 09:30']);
  });

  it('never returns the moment it was asked about', () => {
    const onSlot = new Date(2026, 10, 12, 9, 0);
    expect(stamps(nextRuns(halfHourly, onSlot, 1))).toEqual(['11/12 09:30']);
  });

  it('runs every other hour from midnight when no window is set', () => {
    const runs = nextRuns(
      timing({ every: 2, unit: 'hours', from: '00:00' }),
      new Date(2026, 10, 12, 21, 5),
      3,
    );
    expect(stamps(runs)).toEqual(['11/12 22:00', '11/13 00:00', '11/13 02:00']);
  });

  it('runs every third day from the anchor', () => {
    const runs = nextRuns(timing({ every: 3 }), new Date(2026, 10, 9, 12, 0), 2);
    expect(stamps(runs)).toEqual(['11/12 09:00', '11/15 09:00']);
  });

  it('runs every second week on the chosen weekdays', () => {
    const runs = nextRuns(
      timing({ every: 2, unit: 'weeks', days: [1, 3] }),
      new Date(2026, 10, 9, 12, 0),
      3,
    );
    expect(stamps(runs)).toEqual(['11/11 09:00', '11/23 09:00', '11/25 09:00']);
  });

  it('returns nothing for a window that holds no slot', () => {
    expect(
      nextRuns(
        timing({ unit: 'minutes', every: 30, from: '10:00', to: '09:00' }),
        new Date(2026, 10, 9),
        1,
      ),
    ).toEqual([]);
  });
});

describe('runsPerDay', () => {
  it('counts the slots of one day', () => {
    expect(runsPerDay(halfHourly)).toBe(19);
    expect(runsPerDay(timing({ every: 1, unit: 'hours', from: '00:00' }))).toBe(24);
    expect(runsPerDay(timing({ every: 2, unit: 'weeks' }))).toBe(1);
  });
});

describe('missedRun', () => {
  it('reports the first run missed since the last check, once', () => {
    const asleepFrom = new Date(2026, 10, 12, 9, 10);
    const awake = new Date(2026, 10, 12, 11, 20);
    const missed = missedRun(halfHourly, asleepFrom, awake);
    expect(missed === null ? null : stamps([missed])).toEqual(['11/12 09:30']);
    expect(missedRun(halfHourly, awake, new Date(2026, 10, 12, 11, 25))).toBeNull();
  });
});

describe('workflowScheduleSchema', () => {
  it('fills defaults and refuses a bad clock', () => {
    const base = {
      enabled: true,
      every: 30,
      unit: 'minutes',
      anchor: '2026-11-12',
      projectId: null,
    };
    expect(workflowScheduleSchema.parse(base)).toMatchObject({
      days: [],
      from: '00:00',
      to: null,
      message: '',
      missed: 'run_once',
    });
    expect(workflowScheduleSchema.safeParse({ ...base, from: '24:00' }).success).toBe(false);
    expect(workflowScheduleSchema.safeParse({ ...base, every: 0 }).success).toBe(false);
  });
});
