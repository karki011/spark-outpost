import { describe, expect, it } from 'vitest';
import {
  NO_CALENDAR_MARKS,
  dayShape,
  eventKey,
  freeBlocks,
  isFocusTitle,
  localDayStart,
  longestFree,
  mergeEvents,
  type CalendarChoice,
} from './calendar.ts';
import type { HelperEvent } from './calendar-helper.ts';

const DAY = new Date(2026, 9, 16).getTime();
const at = (hours: number, minutes = 0) => new Date(2026, 9, 16, hours, minutes).toISOString();

function calendar(key: string, overrides: Partial<CalendarChoice> = {}): CalendarChoice {
  return {
    key,
    calendarId: `cal-${key}`,
    title: key,
    sourceId: 'local',
    sourceTitle: 'On My Mac',
    sourceKind: 'local',
    color: '#336699',
    writable: true,
    subscribed: false,
    ownership: 'mine',
    include: true,
    nudges: false,
    ...overrides,
  };
}

const WORK = calendar('00000000-0000-4000-8000-000000000001', { nudges: true });
const FAMILY = calendar('00000000-0000-4000-8000-000000000002');
const HIDDEN = calendar('00000000-0000-4000-8000-000000000003', { include: false });

function event(overrides: Partial<HelperEvent> & { start: string; end: string }): HelperEvent {
  return {
    id: `id-${overrides.title ?? 'x'}-${overrides.calendarId ?? WORK.calendarId}-${overrides.start}`,
    uid: null,
    allDay: false,
    title: 'Event',
    calendarId: WORK.calendarId,
    url: null,
    location: null,
    noteLinks: [],
    hasNotes: false,
    attendeeCount: 0,
    othersInvited: false,
    myStatus: 'none',
    availability: 'busy',
    recurring: false,
    ...overrides,
  };
}

const merge = (events: HelperEvent[], calendars = [WORK, FAMILY, HIDDEN]) =>
  mergeEvents({ events, calendars, focusNames: ['Focus', 'Deep work'], marks: NO_CALENDAR_MARKS });

describe('mergeEvents', () => {
  it('shows copies with the same uid and start once, as the first calendar copy', () => {
    const shared = { uid: 'invite-1', title: 'Design review', start: at(14), end: at(14, 45) };
    const merged = merge([
      event({ ...shared, calendarId: FAMILY.calendarId }),
      event({ ...shared, calendarId: WORK.calendarId }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      calendarKey: WORK.key,
      also: [FAMILY.key],
      nudges: true,
      busy: true,
    });
  });

  it('keeps copies of one uid at different starts apart', () => {
    const merged = merge([
      event({ uid: 'daily', start: at(9), end: at(9, 15) }),
      event({ uid: 'daily', start: at(10), end: at(10, 15) }),
    ]);
    expect(merged.map((item) => item.key)).toEqual([
      eventKey({ uid: 'daily', id: '', start: at(9) }),
      eventKey({ uid: 'daily', id: '', start: at(10) }),
    ]);
  });

  it('is busy on every included calendar, and nudges if any copy does', () => {
    const quiet = calendar('00000000-0000-4000-8000-000000000004');
    const shared = { uid: 'u', start: at(11), end: at(12) };
    const merged = merge(
      [
        event({ ...shared, calendarId: quiet.calendarId }),
        event({ ...shared, calendarId: WORK.calendarId }),
      ],
      [quiet, WORK],
    );
    expect(merged[0]).toMatchObject({ busy: true, nudges: true, calendarKey: quiet.key });
  });

  it('leaves out calendars that are not included', () => {
    expect(merge([event({ calendarId: HIDDEN.calendarId, start: at(9), end: at(10) })])).toEqual(
      [],
    );
  });

  it('is not busy for all-day, free and declined events', () => {
    const merged = merge([
      event({ title: 'All day', allDay: true, start: at(0), end: at(23, 59) }),
      event({ title: 'Free', availability: 'free', start: at(9), end: at(10) }),
      event({ title: 'Declined', myStatus: 'declined', start: at(10), end: at(11) }),
    ]);
    expect(merged.map((item) => item.busy)).toEqual([false, false, false]);
  });

  it('finds the join link and marks focus blocks by title', () => {
    const [standup, focus] = merge([
      event({
        title: 'Standup',
        noteLinks: ['https://acme.zoom.us/j/1'],
        start: at(9),
        end: at(9, 15),
      }),
      event({ title: 'Focus: dashboards', start: at(11), end: at(12) }),
    ]);
    expect(standup?.link?.service).toBe('zoom');
    expect(focus?.focus).toBe(true);
  });
});

describe('isFocusTitle', () => {
  it.each([
    ['Focus', true],
    ['focus: dashboards', true],
    ['Deep work', true],
    ['Deep workshop', false],
    ['Focused review', false],
    ['Team focus', false],
  ])('%s', (title, expected) => {
    expect(isFocusTitle(title, ['Focus', 'Deep work'])).toBe(expected);
  });
});

describe('free blocks and day shape', () => {
  const day = merge([
    event({ title: 'Standup', start: at(9, 30), end: at(9, 45) }),
    event({ title: 'Focus: dashboards', start: at(11), end: at(12, 30) }),
    event({ title: 'Lunch', calendarId: FAMILY.calendarId, start: at(12, 30), end: at(13, 15) }),
    event({ title: 'Review', start: at(14), end: at(14, 45) }),
    event({ title: 'Customer', start: at(16, 30), end: at(17) }),
    event({ title: 'Handoff', start: at(17), end: at(17, 15) }),
    event({ title: 'Late', start: at(17, 50), end: at(19) }),
    event({ title: 'Free hold', availability: 'free', start: at(15), end: at(16) }),
  ]);

  it('lists gaps of 30 min or more between 9:00 and 18:00', () => {
    const blocks = freeBlocks(day, DAY).map((block) => [
      new Date(block.start).getHours() * 60 + new Date(block.start).getMinutes(),
      new Date(block.end).getHours() * 60 + new Date(block.end).getMinutes(),
    ]);
    expect(blocks).toEqual([
      [9 * 60, 9 * 60 + 30],
      [9 * 60 + 45, 11 * 60],
      [13 * 60 + 15, 14 * 60],
      [14 * 60 + 45, 16 * 60 + 30],
      [17 * 60 + 15, 17 * 60 + 50],
    ]);
  });

  it('a clear day is one free block', () => {
    expect(freeBlocks([], DAY)).toHaveLength(1);
    expect(dayShape([], DAY)).toMatchObject({ load: 'Clear', freeMinutes: 540, meetingMinutes: 0 });
  });

  it('measures meetings, focus and free time inside the window', () => {
    const shape = dayShape(day, DAY);
    expect(shape.focusMinutes).toBe(90);
    expect(shape.meetingMinutes).toBe(15 + 45 + 45 + 30 + 15 + 10);
    expect(shape.load).toBe('Balanced');
    expect(shape.freeMinutes).toBe(30 + 75 + 45 + 105 + 35);
  });

  it('finds the longest free block', () => {
    const longest = longestFree(freeBlocks(day, DAY));
    expect(longest && (longest.end - longest.start) / 60_000).toBe(105);
    expect(longestFree([])).toBeNull();
  });

  it('measures a day from local midnight', () => {
    expect(localDayStart(Date.parse(at(15)))).toBe(DAY);
  });
});
