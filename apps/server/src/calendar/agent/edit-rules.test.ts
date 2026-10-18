import { describe, expect, it } from 'vitest';
import type { CalendarChoice, CalendarEventFacts } from '@spark-outpost/contracts';
import {
  completeFields,
  editRefusal,
  factsAfter,
  floorReasons,
  isSynced,
  newEventProblem,
  sameEvent,
  timesProblem,
} from './edit-rules.ts';
import { googleWriteBody } from './google-client.ts';

function choice(overrides: Partial<CalendarChoice> = {}): CalendarChoice {
  return {
    key: '00000000-0000-4000-8000-000000000001',
    calendarId: 'work',
    title: 'Work',
    sourceId: 'local',
    sourceTitle: 'On My Mac',
    sourceKind: 'local',
    color: '#336699',
    writable: true,
    subscribed: false,
    ownership: 'mine',
    include: true,
    nudges: true,
    agentsEdit: true,
    ...overrides,
  };
}

const MEETING: CalendarEventFacts = {
  title: 'Planning',
  start: '2026-10-19T10:00:00.000Z',
  end: '2026-10-19T10:30:00.000Z',
  allDay: false,
  location: null,
  notes: null,
  alarmMinutes: null,
  others: 0,
  recurring: false,
};

describe('who may change a calendar', () => {
  it('refuses a calendar without Agents can edit, and a read-only one', () => {
    const facts = { googleCanEdit: true, span: 'this' as const };
    expect(editRefusal({ choice: choice({ agentsEdit: false }), ...facts })).toContain(
      'Agents can edit',
    );
    expect(editRefusal({ choice: choice({ writable: false }), ...facts })).toContain('read-only');
    expect(editRefusal({ choice: choice(), ...facts })).toBeNull();
  });

  it('needs the Google editing grant and changes one Google occurrence at a time', () => {
    const google = choice({ sourceKind: 'google', calendarId: 'google:a:me@example.com' });
    expect(editRefusal({ choice: google, googleCanEdit: false, span: 'this' })).toContain(
      'Sign in again',
    );
    expect(editRefusal({ choice: google, googleCanEdit: true, span: 'future' })).toContain(
      'one occurrence',
    );
    expect(editRefusal({ choice: google, googleCanEdit: true, span: 'this' })).toBeNull();
  });
});

describe('the floor', () => {
  it('asks for a delete, other people and any calendar that is not plainly mine', () => {
    expect(floorReasons('update', choice(), 0)).toEqual([]);
    expect(floorReasons('delete', choice(), 0)).toEqual(['delete']);
    expect(floorReasons('update', choice(), 2)).toEqual(['others']);
    expect(floorReasons('create', choice({ ownership: 'shared' }), 0)).toEqual(['shared']);
    expect(floorReasons('create', choice({ ownership: 'unknown' }), 0)).toEqual(['shared']);
    expect(floorReasons('delete', choice({ ownership: 'unknown' }), 3)).toEqual([
      'delete',
      'others',
      'shared',
    ]);
  });

  it('counts every calendar but On My Mac as synced', () => {
    expect(isSynced(choice())).toBe(false);
    expect(isSynced(choice({ sourceKind: 'caldav' }))).toBe(true);
    expect(isSynced(choice({ sourceKind: 'google' }))).toBe(true);
  });
});

describe('the change a card shows', () => {
  it('keeps the length when only the start moves', () => {
    const fields = completeFields({ start: '2026-10-19T17:00:00.000Z' }, MEETING);
    expect(fields.end).toBe('2026-10-19T17:30:00.000Z');
    expect(factsAfter(MEETING, fields)).toMatchObject({
      title: 'Planning',
      start: '2026-10-19T17:00:00.000Z',
      end: '2026-10-19T17:30:00.000Z',
    });
  });

  it('checks a new event and its times', () => {
    expect(newEventProblem({ start: MEETING.start, end: MEETING.end })).toContain('title');
    expect(newEventProblem({ title: 'x' })).toContain('start and end');
    const backwards = factsAfter(null, { title: 'x', start: MEETING.end, end: MEETING.start });
    expect(timesProblem(backwards)).toContain('after the start');
  });

  it('notices an event that changed since the card', () => {
    expect(sameEvent(MEETING, { ...MEETING })).toBe(true);
    expect(sameEvent(MEETING, { ...MEETING, title: 'Renamed' })).toBe(false);
    expect(sameEvent(MEETING, { ...MEETING, others: 1 })).toBe(false);
  });

  it('writes Google fields, all-day dates and reminders', () => {
    expect(googleWriteBody({ title: 'x', alarmMinutes: null }, false)).toEqual({
      summary: 'x',
      reminders: { useDefault: false, overrides: [] },
    });
    const allDay = googleWriteBody(
      { start: new Date(2026, 9, 19).toISOString(), end: new Date(2026, 9, 20).toISOString() },
      true,
    );
    expect(allDay).toEqual({ start: { date: '2026-10-19' }, end: { date: '2026-10-20' } });
  });
});
