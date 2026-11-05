import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './calendar.ts';
import { clashList, clashText, joinableMeetings, meetingsOverlap } from './calendar-clash.ts';
import { JOIN_LEAD_MS } from './calendar-join.ts';

const MINUTE = 60_000;
const NOW = new Date(2026, 9, 16, 10, 0).getTime();
const at = (minutes: number) => new Date(NOW + minutes * MINUTE).toISOString();
const ZOOM = {
  url: 'https://acme.zoom.us/j/1',
  host: 'acme.zoom.us',
  service: 'zoom' as const,
  unwrappedFrom: null,
};

function meeting(title: string, from: number, to: number, extra: Partial<CalendarEvent> = {}) {
  return {
    key: `${title}@${at(from)}`,
    id: title,
    uid: title,
    start: at(from),
    end: at(to),
    allDay: false,
    title,
    calendarKey: '00000000-0000-4000-8000-000000000001',
    also: [],
    link: null,
    attendeeCount: 3,
    othersInvited: true,
    myStatus: 'accepted',
    availability: 'busy',
    recurring: false,
    hasNotes: false,
    hasLocation: false,
    busy: true,
    nudges: true,
    focus: false,
    remind: false,
    hold: false,
    dismissed: false,
    ...extra,
  } satisfies CalendarEvent;
}

describe('meetingsOverlap', () => {
  it('is true only for two different meetings whose times overlap', () => {
    const call = meeting('Customer call', 30, 60);
    expect(meetingsOverlap(call, meeting('Vendor sync', 45, 75))).toBe(true);
    expect(meetingsOverlap(call, meeting('Lunch', 60, 90))).toBe(false);
    expect(meetingsOverlap(call, call)).toBe(false);
    expect(meetingsOverlap(call, meeting('Focus', 40, 50, { focus: true }))).toBe(false);
    expect(meetingsOverlap(call, meeting('Skip', 40, 50, { myStatus: 'declined' }))).toBe(false);
    expect(meetingsOverlap(call, meeting('Holiday', 0, 1440, { allDay: true }))).toBe(false);
  });
});

describe('clash tags', () => {
  it('lists only meetings with a clash and words one or several', () => {
    const events = [
      meeting('A', 0, 30),
      meeting('B', 0, 30),
      meeting('C', 10, 20),
      meeting('D', 40, 50),
    ];
    expect(clashList(events, events)).toEqual([
      { eventKey: events[0]!.key, titles: ['B', 'C'] },
      { eventKey: events[1]!.key, titles: ['A', 'C'] },
      { eventKey: events[2]!.key, titles: ['A', 'B'] },
    ]);
    expect(clashText(['B'])).toBe('clashes with B');
    expect(clashText(['A', 'B'])).toBe('clashes with 2 meetings');
    expect(clashText([])).toBeNull();
  });
});

describe('joinableMeetings', () => {
  it('keeps meetings with a link inside the Join window, once each, by start', () => {
    const late = meeting('Late', 9, 30, { link: ZOOM });
    const early = meeting('Early', 5, 30, { link: ZOOM });
    const noLink = meeting('Room', 5, 30);
    const later = meeting('Later', JOIN_LEAD_MS / MINUTE + 1, 60, { link: ZOOM });
    const open = joinableMeetings([late, early, noLink, later, early], NOW);
    expect(open.map((item) => item.title)).toEqual(['Early', 'Late']);
  });
});
