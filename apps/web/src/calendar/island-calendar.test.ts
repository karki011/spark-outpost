import { describe, expect, it } from 'vitest';
import type { CalendarNow, CalendarNudge } from '@spark-outpost/contracts';
import { at, event, link } from './test-fixtures.ts';
import {
  calendarLine,
  catchUpText,
  hopKeys,
  NO_HELD,
  nudgeText,
  tallyHeld,
} from './island-calendar.ts';

const iso = (time: number) => new Date(time).toISOString();
const CHAT = '00000000-0000-4000-8000-000000000001';

function nudge(kind: CalendarNudge['kind'], title: string, startsAt: number): CalendarNudge {
  const base = { eventKey: `${title}@x`, title, startsAt: iso(startsAt), minutes: 10 };
  if (kind === 'wrap_up') return { ...base, kind, chats: [] };
  return { ...base, kind, group: [] };
}

function now(overrides: Partial<CalendarNow> = {}): CalendarNow {
  return {
    active: true,
    upcoming: [],
    nudge: null,
    hold: null,
    capture: null,
    clashes: [],
    calendars: [],
    ...overrides,
  };
}

const input = (calendar: CalendarNow | null, extra = {}) => ({
  now: calendar,
  at: at(9, 50),
  waiting: 0,
  catchUp: null,
  dismissed: new Set<string>(),
  ...extra,
});

describe('nudgeText', () => {
  it('counts down to the meeting from its start and names the chats that need you', () => {
    const before = nudge('before', 'Standup', at(10));
    expect(nudgeText(before, at(9, 50), 2)).toBe('Standup in 10 min · 2 chats need you');
    expect(nudgeText(before, at(9, 50, 30), 1)).toBe('Standup in 10 min · 1 chat needs you');
    expect(nudgeText(before, at(9, 52), 0)).toBe('Standup in 8 min');
    expect(nudgeText(before, at(10), 0)).toBe('Standup now');
  });

  it('reminds without the chat count', () => {
    expect(nudgeText(nudge('remind', 'Design review', at(10)), at(9, 55), 3)).toBe(
      'Design review in 5 min',
    );
  });

  it('names the chat a wrap-up is about', () => {
    const base = nudge('wrap_up', 'Design review', at(10, 5));
    if (base.kind !== 'wrap_up') throw new Error('wrap_up');
    const running = { ...base, chats: [{ id: CHAT, title: 'dashboards', reason: 'running' }] };
    const needs = { ...base, chats: [{ id: CHAT, title: 'dashboards', reason: 'needs_you' }] };
    expect(nudgeText(running as CalendarNudge, at(9, 50), 0)).toBe(
      'Meeting in 15 min · the dashboards chat is still running',
    );
    expect(nudgeText(needs as CalendarNudge, at(9, 50), 0)).toBe(
      'Meeting in 15 min · the dashboards chat needs you',
    );
    expect(nudgeText(base, at(9, 50), 0)).toBe('Meeting in 15 min');
  });
});

describe('held chimes', () => {
  it('counts each held chime and words the catch-up line', () => {
    const tally = ['needs', 'needs', 'done'].reduce(
      (sum, chime) => tallyHeld(sum, chime as 'needs' | 'done'),
      NO_HELD,
    );
    expect(catchUpText({ label: 'Focus', tally })).toBe(
      'While you were in Focus: 2 chats need you, 1 finished',
    );
    expect(catchUpText({ label: 'Standup', tally: tallyHeld(NO_HELD, 'failed') })).toBe(
      'While you were in Standup: 1 failed',
    );
    expect(catchUpText({ label: 'Focus', tally: NO_HELD })).toBeNull();
  });
});

describe('calendarLine', () => {
  const hold = {
    eventKey: 'focus@x',
    title: 'Focus: dashboards',
    until: iso(at(11, 30)),
    focus: true,
  };
  const capture = {
    eventKey: 'review@x',
    eventId: 'review',
    start: iso(at(9)),
    title: 'Design review',
  };
  const catchUp = { label: 'Focus', tally: tallyHeld(NO_HELD, 'needs') };

  it('shows nothing when the calendar is off or quiet', () => {
    expect(calendarLine(input(null))).toBeNull();
    expect(calendarLine(input(now({ active: false })))).toBeNull();
    expect(calendarLine(input(now()))).toBeNull();
  });

  it('puts the meeting nudge first, even in a hold, then the hold, catch-up and capture', () => {
    const all = now({ hold, capture, nudge: nudge('before', 'Standup', at(10)) });
    expect(calendarLine(input(all, { catchUp }))?.text).toBe('Standup in 10 min');
    const quiet = { ...all, nudge: null };
    expect(calendarLine(input(quiet, { catchUp }))?.text).toBe('Focus · alerts held until 11:30');
    expect(calendarLine(input({ ...quiet, hold: null }, { catchUp }))?.dismiss).toBe('catch_up');
    expect(calendarLine(input({ ...quiet, hold: null }))?.text).toBe(
      'Design review ended · anything to capture?',
    );
    expect(
      calendarLine(input({ ...quiet, hold: null }, { dismissed: new Set(['review@x']) })),
    ).toBeNull();
  });

  it('names a meeting hold by its title', () => {
    expect(
      calendarLine(input(now({ hold: { ...hold, focus: false, title: 'Standup' } })))?.text,
    ).toBe('Standup · alerts held until 11:30');
  });

  it('keeps the catch-up line after the calendar is disconnected', () => {
    expect(calendarLine(input(now({ active: false }), { catchUp }))?.text).toBe(
      'While you were in Focus: 1 chat needs you',
    );
  });

  it('carries the nudged meeting for Join, and offers Join alone once it opens', () => {
    const standup = event('Standup', at(10), at(10, 15), { link: link('zoom') });
    const calendar = now({
      upcoming: [standup],
      nudge: { ...nudge('before', 'Standup', at(10)), eventKey: standup.key },
    });
    expect(calendarLine(input(calendar))?.join?.key).toBe(standup.key);
    expect(calendarLine(input({ ...calendar, nudge: null }, { at: at(9, 45) }))).toBeNull();
    const late = calendarLine(input({ ...calendar, nudge: null }, { at: at(10, 2) }));
    expect(late?.text).toBe('Standup now');
    expect(late?.join?.link?.host).toBe('acme.zoom.us');
  });

  it('hops once per meeting nudge, not for a wrap-up', () => {
    expect(hopKeys(now({ nudge: nudge('before', 'Standup', at(10)) }))).toEqual([
      'before:Standup@x',
    ]);
    expect(hopKeys(now({ nudge: nudge('remind', 'Standup', at(10)) }))).toEqual([
      'remind:Standup@x',
    ]);
    expect(hopKeys(now({ nudge: nudge('wrap_up', 'Standup', at(10)) }))).toEqual([]);
    expect(hopKeys(now({ active: false, nudge: nudge('before', 'Standup', at(10)) }))).toEqual([]);
  });

  it('turns meetings that start together into one Choose line and one hop', () => {
    const standup = event('Standup', at(10), at(10, 15), { link: link('zoom') });
    const design = event('Design sync', at(10), at(10, 30), { link: link('meet') });
    const room = event('Room booking', at(10), at(10, 30));
    const grouped = {
      ...nudge('before', 'Standup', at(10)),
      eventKey: standup.key,
      group: [standup, design, room],
    };
    const calendar = now({ upcoming: [standup, design, room], nudge: grouped });
    const line = calendarLine(input(calendar));
    expect(line?.text).toBe('Standup + 2 more at 10:00');
    expect(line?.join).toBeNull();
    expect(line?.choose?.map((item) => item.title)).toEqual([
      'Standup',
      'Design sync',
      'Room booking',
    ]);
    expect(line?.key).toBe(`before:${standup.key}:3`);
    expect(hopKeys(calendar)).toEqual([
      `before:${standup.key}`,
      `before:${design.key}`,
      `before:${room.key}`,
    ]);
  });
});
