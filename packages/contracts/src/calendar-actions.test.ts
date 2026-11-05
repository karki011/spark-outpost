import { describe, expect, it } from 'vitest';
import {
  calendarAuditFacts,
  calendarEditActionSchema,
  isCalendarAction,
} from './calendar-actions.ts';
import {
  calendarHelperLineSchema,
  calendarHelperRequestSchema,
  calendarHelperResultSchemas,
} from './calendar-helper.ts';
import { calendarBridgeToHostSchema, calendarHostResultSchemas } from './calendar-bridge.ts';
import {
  GOOGLE_CALENDAR_LIST_SCOPE,
  GOOGLE_EVENTS_EDIT_SCOPE,
  GOOGLE_EVENTS_READ_SCOPE,
  googleScopesEdit,
  googleScopesRead,
} from './calendar-google.ts';

const EVENT = {
  id: 'ek-1',
  uid: null,
  start: '2026-10-19T15:00:00+02:00',
  end: '2026-10-19T16:00:00+02:00',
  allDay: false,
  title: 'Spark 1b test',
  calendarId: 'cal',
  url: null,
  location: null,
  noteLinks: [],
  hasNotes: false,
  attendeeCount: 0,
  othersInvited: false,
  myStatus: 'none',
  availability: 'busy',
  recurring: false,
};

const DETAIL = { event: EVENT, notes: '', attendees: [], organizerIsMe: true, alarms: [10] };

describe('the helper write protocol', () => {
  it('accepts the save and remove requests Spark sends', () => {
    const save = {
      id: 'r1',
      op: 'save',
      calendarId: 'cal',
      eventId: 'ek-1',
      occurrence: '2026-10-19T13:00:00.000Z',
      fields: { start: '2026-10-19T15:00:00.000Z', alarmMinutes: null },
      span: 'future',
    };
    expect(calendarHelperRequestSchema.parse(save)).toEqual(save);
    expect(
      calendarHelperRequestSchema.safeParse({ ...save, fields: { color: 'red' } }).success,
    ).toBe(false);
    expect(
      calendarHelperRequestSchema.safeParse({ id: 'r2', op: 'remove', eventId: 'ek-1' }).success,
    ).toBe(false);
  });

  it('reads the saved and removed answers the Swift helper writes', () => {
    const line =
      '{"id":"r1","ok":true,"result":{"after":' + JSON.stringify(DETAIL) + ',"before":null}}';
    const parsed = calendarHelperLineSchema.parse(JSON.parse(line)) as { result: unknown };
    expect(calendarHelperResultSchemas.save.parse(parsed.result)).toEqual({
      before: null,
      after: DETAIL,
    });
    expect(calendarHelperResultSchemas.remove.parse({ removed: true })).toEqual({ removed: true });
    expect(calendarHostResultSchemas.save.safeParse({ after: DETAIL }).success).toBe(false);
  });

  it('carries writes over the bridge', () => {
    const message = {
      kind: 'calendar:request',
      id: 'b1',
      request: { op: 'remove', eventId: 'ek-1', start: '2026-10-19T13:00:00.000Z' },
    };
    expect(calendarBridgeToHostSchema.parse(message)).toEqual(message);
  });
});

describe('calendar cards', () => {
  const action = calendarEditActionSchema.parse({
    action: 'calendar_edit',
    op: 'update',
    calendar: {
      key: '00000000-0000-4000-8000-000000000001',
      title: 'Spark Test',
      account: 'On My Mac',
      synced: false,
    },
    eventId: 'ek-1',
    occurrence: '2026-10-19T13:00:00.000Z',
    span: 'this',
    fields: { title: 'Secret offsite', notes: 'Bring the plans' },
    before: null,
    after: null,
    floor: [],
  });

  it('keeps titles and notes out of what Spark audits', () => {
    const audited = JSON.stringify(calendarAuditFacts(action));
    expect(audited).not.toContain('Secret offsite');
    expect(audited).not.toContain('Bring the plans');
    expect(calendarAuditFacts(action)).toMatchObject({ changed: ['notes', 'title'] });
  });

  it('names the calendar actions', () => {
    expect(isCalendarAction('calendar_edit')).toBe(true);
    expect(isCalendarAction('calendar_read')).toBe(true);
    expect(isCalendarAction('mac_act')).toBe(false);
  });
});

describe('Google scopes', () => {
  it('reads with either events scope and edits only with calendar.events', () => {
    expect(googleScopesRead([GOOGLE_CALENDAR_LIST_SCOPE, GOOGLE_EVENTS_READ_SCOPE])).toBe(true);
    expect(googleScopesRead([GOOGLE_CALENDAR_LIST_SCOPE, GOOGLE_EVENTS_EDIT_SCOPE])).toBe(true);
    expect(googleScopesRead([GOOGLE_EVENTS_EDIT_SCOPE])).toBe(false);
    expect(googleScopesEdit([GOOGLE_EVENTS_READ_SCOPE])).toBe(false);
    expect(googleScopesEdit([GOOGLE_EVENTS_EDIT_SCOPE])).toBe(true);
  });
});
