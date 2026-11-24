import { describe, expect, it } from 'vitest';
import { joinLink, microsoftScopesEdit, microsoftScopesRead } from '@spark-outpost/contracts';
import { microsoftWriteBody } from '../agent/microsoft-client.ts';
import { sameGraphOrigin, type GraphEvent } from './api.ts';
import {
  mapMicrosoftCalendar,
  mapMicrosoftEvent,
  microsoftWebLink,
  splitMicrosoftEventId,
} from './map.ts';

const ACCOUNT = '6f1c2f2e-0d7b-4a7e-9a52-0c8e1c9b2a11';
const ME = 'me@contoso.com';
const context = { accountId: ACCOUNT, calendarId: 'AAMkCal', email: ME, seriesUid: null };

const event = (extra: Partial<GraphEvent> = {}): GraphEvent => ({
  id: 'AAMkEvent=',
  iCalUId: 'uid-1',
  type: 'singleInstance',
  subject: 'Planning',
  start: { dateTime: '2026-11-23T14:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-11-23T14:30:00.0000000', timeZone: 'UTC' },
  ...extra,
});

describe('mapMicrosoftEvent', () => {
  it('reads Graph times as UTC and keeps a Teams join link', () => {
    const mapped = mapMicrosoftEvent(
      context,
      event({
        onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0' },
      }),
    );
    expect(mapped).toMatchObject({
      id: `microsoft:${ACCOUNT}:AAMkEvent=`,
      uid: 'uid-1',
      start: '2026-11-23T14:00:00.000Z',
      end: '2026-11-23T14:30:00.000Z',
      allDay: false,
      calendarId: `microsoft:${ACCOUNT}:AAMkCal`,
      myStatus: 'none',
      othersInvited: false,
      availability: 'busy',
      recurring: false,
    });
    expect(joinLink(mapped!)?.service).toBe('teams');
    expect(splitMicrosoftEventId(mapped!.id)).toEqual({
      accountId: ACCOUNT,
      eventId: 'AAMkEvent=',
    });
  });

  it('skips cancelled events and times in a zone it was not asked for', () => {
    expect(mapMicrosoftEvent(context, event({ isCancelled: true }))).toBeNull();
    const zoned = event({
      start: { dateTime: '2026-11-23T14:00:00', timeZone: 'Pacific Standard Time' },
    });
    expect(mapMicrosoftEvent(context, zoned)).toBeNull();
  });

  it('names an occurrence by its series and counts the organizer as someone else', () => {
    const mapped = mapMicrosoftEvent(
      { ...context, seriesUid: 'series-uid' },
      event({
        type: 'occurrence',
        seriesMasterId: 'AAMkMaster',
        iCalUId: 'per-occurrence',
        isOrganizer: false,
        organizer: { emailAddress: { address: 'pat@contoso.com' } },
        attendees: [{ type: 'required', emailAddress: { address: 'ME@contoso.com' } }],
        responseStatus: { response: 'accepted' },
        showAs: 'free',
      }),
    );
    expect(mapped).toMatchObject({
      uid: 'series-uid',
      recurring: true,
      othersInvited: true,
      myStatus: 'accepted',
      availability: 'free',
      attendeeCount: 1,
    });
  });
});

describe('Microsoft calendars and links', () => {
  it('maps the default calendar as mine and keeps only Outlook web links', () => {
    expect(
      mapMicrosoftCalendar(ACCOUNT, ME, {
        id: 'AAMkCal',
        name: 'Calendar',
        canEdit: true,
        isDefaultCalendar: true,
        hexColor: '',
      }),
    ).toMatchObject({
      sourceKind: 'microsoft',
      ownership: 'mine',
      writable: true,
      color: '#0078d4',
    });
    expect(
      mapMicrosoftCalendar(ACCOUNT, ME, {
        id: 'AAMkShared',
        name: 'Team',
        canEdit: false,
        owner: { address: 'pat@contoso.com' },
      }),
    ).toMatchObject({ ownership: 'shared', writable: false });
    expect(microsoftWebLink('https://outlook.office365.com/owa/?itemid=1')).toBe(
      'https://outlook.office365.com/owa/?itemid=1',
    );
    expect(microsoftWebLink('https://evil.example/owa')).toBeNull();
    expect(
      sameGraphOrigin('https://graph.microsoft.com/v1.0', 'https://graph.microsoft.com/v1.0/me/x'),
    ).toBe(true);
    expect(
      sameGraphOrigin('https://graph.microsoft.com/v1.0', 'https://graph.evil.com/v1.0/me'),
    ).toBe(false);
  });

  it('reads granted scopes with or without the Graph prefix', () => {
    expect(microsoftScopesRead(['openid', 'https://graph.microsoft.com/Calendars.Read'])).toBe(
      true,
    );
    expect(microsoftScopesRead(['calendars.readwrite'])).toBe(true);
    expect(microsoftScopesEdit(['https://graph.microsoft.com/Calendars.Read'])).toBe(false);
    expect(microsoftScopesRead(['openid', 'User.Read'])).toBe(false);
  });

  it('writes event changes in UTC, with an all-day event on whole days', () => {
    const after = {
      title: 'Offsite',
      start: '2026-11-24T15:00:00.000Z',
      end: '2026-11-24T16:00:00.000Z',
      allDay: false,
      location: null,
      notes: null,
      alarmMinutes: null,
      others: 0,
      recurring: false,
    };
    expect(microsoftWriteBody({ start: after.start, alarmMinutes: null }, after)).toEqual({
      isAllDay: false,
      start: { dateTime: '2026-11-24T15:00:00.000', timeZone: 'UTC' },
      end: { dateTime: '2026-11-24T16:00:00.000', timeZone: 'UTC' },
      isReminderOn: false,
    });
    const allDay = microsoftWriteBody({ allDay: true }, { ...after, allDay: true });
    expect(allDay.isAllDay).toBe(true);
    expect(allDay.start?.dateTime).toMatch(/T00:00:00$/);
    expect(allDay.end!.dateTime > allDay.start!.dateTime).toBe(true);
  });
});
