import { describe, expect, it } from 'vitest';
import {
  eventsByDay,
  initials,
  keyMove,
  monthGrid,
  preview,
  setMonth,
  shiftMonth,
  timeGroups,
} from './month-model.ts';
import { at, event } from './test-fixtures.ts';

const SUNDAY = 0;
const MONDAY = 1;

describe('monthGrid', () => {
  it('lays out six full weeks from the week start, flagging past, today and other months', () => {
    const grid = monthGrid('2026-10-16', '2026-10-16', SUNDAY);
    const cells = grid.weeks.flat();
    expect(grid.weeks).toHaveLength(6);
    expect(cells).toHaveLength(42);
    expect(grid).toMatchObject({ year: 2026, month: 9, from: '2026-09-27', to: '2026-11-08' });
    expect(cells[0]).toMatchObject({ date: '2026-09-27', inMonth: false, past: true });
    expect(cells.find((cell) => cell.today)?.date).toBe('2026-10-16');
    expect(cells.find((cell) => cell.date === '2026-10-15')?.past).toBe(true);
    expect(cells.find((cell) => cell.date === '2026-10-17')?.past).toBe(false);
    expect(cells.at(-1)).toMatchObject({ date: '2026-11-07', inMonth: false });
  });

  it('starts weeks on Monday where the locale does', () => {
    const grid = monthGrid('2026-10-01', '2026-10-16', MONDAY);
    expect(grid.weeks[0]![0]!.date).toBe('2026-09-28');
    expect(grid.from).toBe('2026-09-28');
  });
});

describe('moving between days and months', () => {
  it('moves with the arrows across week and month edges', () => {
    expect(keyMove('ArrowRight', '2026-10-31', SUNDAY)).toBe('2026-11-01');
    expect(keyMove('ArrowLeft', '2026-11-01', SUNDAY)).toBe('2026-10-31');
    expect(keyMove('ArrowDown', '2026-10-29', SUNDAY)).toBe('2026-11-05');
    expect(keyMove('ArrowUp', '2026-10-03', SUNDAY)).toBe('2026-09-26');
  });

  it('jumps to the week edges and changes month with the page keys', () => {
    expect(keyMove('Home', '2026-10-16', SUNDAY)).toBe('2026-10-11');
    expect(keyMove('End', '2026-10-16', SUNDAY)).toBe('2026-10-17');
    expect(keyMove('Home', '2026-10-16', MONDAY)).toBe('2026-10-12');
    expect(keyMove('PageDown', '2026-10-16', SUNDAY)).toBe('2026-11-16');
    expect(keyMove('PageUp', '2026-10-16', SUNDAY)).toBe('2026-09-16');
    expect(keyMove('Tab', '2026-10-16', SUNDAY)).toBeNull();
  });

  it('keeps the day of the month where it can, else the last day', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-15');
    expect(setMonth('2026-10-31', 2027, 1)).toBe('2027-02-28');
  });
});

describe('what a day shows', () => {
  it('puts all-day events first, then by start, and keeps three with a count of the rest', () => {
    const late = event('Late', at(16), at(17));
    const early = event('Early', at(9), at(10));
    const holiday = event('Holiday', at(0), at(24), { allDay: true });
    const other = event('Tomorrow', at(33), at(34));
    const extra = event('Lunch', at(12), at(13));
    const cells = monthGrid('2026-10-16', '2026-10-16', SUNDAY).weeks.flat();
    const byDay = eventsByDay([late, early, holiday, other, extra], cells);
    const day = byDay.get('2026-10-16')!;
    expect(byDay.get('2026-10-17')!.map((item) => item.title)).toEqual(['Tomorrow']);
    expect(day.map((item) => item.title)).toEqual(['Holiday', 'Early', 'Lunch', 'Late']);
    expect(preview(day)).toMatchObject({ more: 1 });
    expect(preview(day).shown.map((item) => item.title)).toEqual(['Holiday', 'Early', 'Lunch']);
  });

  it('groups the rail by the hour each event starts', () => {
    const groups = timeGroups(
      [
        event('Half past', at(9, 30), at(10)),
        event('Nine', at(9), at(9, 15)),
        event('Ten', at(10), at(11)),
        event('Holiday', at(0), at(24), { allDay: true }),
      ],
      '2026-10-16',
    );
    expect(groups.map((group) => [group.label, group.events.map((item) => item.title)])).toEqual([
      ['All day', ['Holiday']],
      ['9:00', ['Nine', 'Half past']],
      ['10:00', ['Ten']],
    ]);
  });

  it('puts an event that spans days in every day it covers', () => {
    const cells = monthGrid('2026-10-16', '2026-10-16', SUNDAY).weeks.flat();
    const offsite = event('Offsite', at(9), at(9 + 48), { allDay: true });
    const byDay = eventsByDay([offsite], cells);
    expect(
      ['2026-10-16', '2026-10-17', '2026-10-18'].map((date) => byDay.get(date)!.length),
    ).toEqual([1, 1, 1]);
    expect(byDay.get('2026-10-19')).toEqual([]);
  });

  it('shows initials for names and email addresses', () => {
    expect(initials('Alex Wong')).toBe('AW');
    expect(initials('ivan.marsh@example.com')).toBe('IM');
    expect(initials('Priya')).toBe('P');
  });
});
