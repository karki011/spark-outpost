import { describe, expect, it } from 'vitest';
import type { CalendarChoice, HelperCalendar } from '@spark-outpost/contracts';
import { lostNotice, rematchCalendars } from './rematch.ts';

function helperCalendar(id: string, title: string, sourceTitle = 'Google'): HelperCalendar {
  return {
    id,
    title,
    sourceId: `src-${sourceTitle}`,
    sourceTitle,
    sourceKind: 'caldav',
    color: '#336699',
    subscribed: false,
    writable: true,
    ownership: 'mine',
  };
}

function saved(key: string, calendar: HelperCalendar, flags: Partial<CalendarChoice> = {}) {
  return {
    key,
    calendarId: calendar.id,
    title: calendar.title,
    sourceId: calendar.sourceId,
    sourceTitle: calendar.sourceTitle,
    sourceKind: calendar.sourceKind,
    color: calendar.color,
    writable: calendar.writable,
    subscribed: calendar.subscribed,
    ownership: calendar.ownership,
    include: true,
    nudges: false,
    ...flags,
  } satisfies CalendarChoice;
}

const WORK = helperCalendar('work-1', 'Work');
const FAMILY = helperCalendar('family-1', 'Family', 'iCloud');
const K1 = '00000000-0000-4000-8000-000000000001';
const K2 = '00000000-0000-4000-8000-000000000002';

describe('rematchCalendars', () => {
  it('adds a new calendar included, with nudges on', () => {
    const match = rematchCalendars([], [WORK]);
    expect(match.writes).toEqual([{ key: null, calendar: WORK, include: true, nudges: true }]);
    expect(match.changed).toBe(true);
  });

  it('keeps choices by identifier and reports no change when nothing moved', () => {
    const before = [saved(K1, WORK, { nudges: true }), saved(K2, FAMILY, { include: false })];
    const match = rematchCalendars(before, [WORK, FAMILY]);
    expect(match.writes.map((write) => [write.key, write.include, write.nudges])).toEqual([
      [K1, true, true],
      [K2, false, false],
    ]);
    expect(match.changed).toBe(false);
    expect(match.lost).toEqual([]);
  });

  it('matches again by source and title after a full sync changes the identifier', () => {
    const before = [saved(K1, WORK, { nudges: false })];
    const resynced = helperCalendar('work-2', 'Work');
    const match = rematchCalendars(before, [resynced]);
    expect(match.writes).toEqual([{ key: K1, calendar: resynced, include: true, nudges: false }]);
    expect(match.lost).toEqual([]);
    expect(match.changed).toBe(true);
  });

  it('resets with a note when the match is ambiguous or gone', () => {
    const before = [saved(K1, WORK, { nudges: false })];
    const twins = [helperCalendar('work-2', 'Work'), helperCalendar('work-3', 'Work')];
    const match = rematchCalendars(before, twins);
    expect(match.writes.every((write) => write.key === null && write.nudges)).toBe(true);
    expect(match.lost.map((choice) => choice.key)).toEqual([K1]);
    expect(lostNotice(match.lost)).toBe(
      'Work (Google) was not found after a calendar sync, so its choices were reset.',
    );
    expect(lostNotice([])).toBeNull();
  });

  it('does not match a calendar with the same title on another account', () => {
    const before = [saved(K1, WORK)];
    const other = helperCalendar('work-9', 'Work', 'Exchange');
    const match = rematchCalendars(before, [other]);
    expect(match.writes[0]?.key).toBeNull();
    expect(match.lost).toHaveLength(1);
  });
});
