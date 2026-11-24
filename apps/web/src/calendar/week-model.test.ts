import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@spark-outpost/contracts';
import { daySpan, weekBlock, weekHours, weekModel, weekTitle, WEEK_HOUR_PX } from './week-model.ts';
import { event as fixture } from './test-fixtures.ts';

const at = (date: string, hour: number, minute = 0) =>
  new Date(
    `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
  ).getTime();

function event(date: string, from: number, to: number): CalendarEvent {
  return fixture('Sync', at(date, from), at(date, to));
}

describe('weekModel', () => {
  it('shows Monday to Friday of the picked week without weekends', () => {
    const week = weekModel('2026-11-25', '2026-11-23', 1, false);
    expect(week.from).toBe('2026-11-23');
    expect(week.to).toBe('2026-11-30');
    expect(week.shown.map((day) => day.date)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
    ]);
    expect(week.shown[0]?.today).toBe(true);
  });

  it('shows seven days from the locale week start with weekends', () => {
    const week = weekModel('2026-11-25', '2026-11-25', 0, true);
    expect(week.shown).toHaveLength(7);
    expect(week.shown[0]?.date).toBe('2026-11-22');
    expect(week.shown.at(-1)?.date).toBe('2026-11-28');
  });
});

describe('weekHours', () => {
  it('covers the working day and widens to fit an early and a late event', () => {
    const week = weekModel('2026-11-25', '2026-11-25', 1, false);
    const quiet = weekHours(week.shown, new Map());
    expect(quiet).toEqual({ start: 8, end: 18 });
    const busy = weekHours(
      week.shown,
      new Map([
        ['2026-11-24', [event('2026-11-24', 6, 7)]],
        ['2026-11-26', [event('2026-11-26', 19, 21)]],
      ]),
    );
    expect(busy).toEqual({ start: 6, end: 21 });
  });
});

describe('weekBlock', () => {
  it('places an event by its start and length on the shared hour scale', () => {
    const day = new Date('2026-11-25T00:00:00').getTime();
    const span = daySpan(day, { start: 8, end: 18 });
    const placed = weekBlock(event('2026-11-25', 10, 11), span);
    expect(placed.top).toBe(2 * WEEK_HOUR_PX);
    expect(placed.height).toBe(WEEK_HOUR_PX);
    expect(placed.twoLines).toBe(true);
    const short = weekBlock(fixture('Quick', at('2026-11-25', 9), at('2026-11-25', 9, 10)), span);
    expect(short.height).toBe(20);
    expect(short.twoLines).toBe(false);
  });
});

describe('weekTitle', () => {
  it('names one month, or both when the week crosses a month', () => {
    const inside = weekModel('2026-11-25', '2026-11-25', 1, false);
    expect(weekTitle(inside.shown)).toBe(
      new Date(2026, 10, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    );
    const across = weekModel('2026-11-30', '2026-11-25', 1, false);
    expect(weekTitle(across.shown)).toContain('–');
  });
});
