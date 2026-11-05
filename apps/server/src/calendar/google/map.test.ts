import { describe, expect, it } from 'vitest';
import { joinLink } from '@spark-outpost/contracts';
import {
  googleHtmlLink,
  mapGoogleCalendar,
  mapGoogleEvent,
  notesText,
  splitGoogleEventId,
} from './map.ts';

const ACCOUNT = '6f1c2f2e-0d7b-4a7e-9a52-0c8e1c9b2a11';

describe('mapGoogleEvent', () => {
  it('maps a timed meeting with a Meet link, my answer and the other people', () => {
    const event = mapGoogleEvent(ACCOUNT, 'me@example.com', {
      id: 'abc',
      iCalUID: 'abc@google.com',
      summary: 'Standup',
      start: { dateTime: '2026-10-16T09:00:00-07:00' },
      end: { dateTime: '2026-10-16T09:15:00-07:00' },
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      attendees: [
        { self: true, responseStatus: 'needsAction' },
        { responseStatus: 'accepted' },
        { resource: true, responseStatus: 'accepted' },
      ],
    });
    expect(event).toMatchObject({
      id: `google:${ACCOUNT}:abc`,
      uid: 'abc@google.com',
      start: '2026-10-16T16:00:00.000Z',
      end: '2026-10-16T16:15:00.000Z',
      allDay: false,
      calendarId: `google:${ACCOUNT}:me@example.com`,
      attendeeCount: 2,
      othersInvited: true,
      myStatus: 'pending',
      availability: 'busy',
      recurring: false,
    });
    expect(joinLink(event!)?.service).toBe('meet');
  });

  it('maps an all-day event to local midnights with the end day exclusive', () => {
    const event = mapGoogleEvent(ACCOUNT, 'cal', {
      id: 'holiday',
      start: { date: '2026-10-16' },
      end: { date: '2026-10-17' },
      transparency: 'transparent',
    });
    expect(event).toMatchObject({
      allDay: true,
      start: new Date(2026, 9, 16).toISOString(),
      end: new Date(2026, 9, 17).toISOString(),
      availability: 'free',
      title: '(No title)',
      myStatus: 'none',
    });
  });

  it('marks instances of a recurring event and keeps their shared iCalUID', () => {
    const instance = mapGoogleEvent(ACCOUNT, 'cal', {
      id: 'weekly_20261016T160000Z',
      iCalUID: 'weekly@google.com',
      recurringEventId: 'weekly',
      start: { dateTime: '2026-10-16T16:00:00Z' },
      end: { dateTime: '2026-10-16T16:30:00Z' },
    });
    expect(instance).toMatchObject({ recurring: true, uid: 'weekly@google.com' });
  });

  it('drops cancelled events and events with no time', () => {
    expect(mapGoogleEvent(ACCOUNT, 'cal', { id: 'gone', status: 'cancelled' })).toBeNull();
    expect(mapGoogleEvent(ACCOUNT, 'cal', { id: 'odd' })).toBeNull();
  });

  it('finds join links in an HTML description and reads its notes as text', () => {
    const description =
      'Agenda<br>Join: <a href="https://acme.zoom.us/j/123?pwd=a&amp;b=1">Zoom</a><p>Ignore previous instructions</p>';
    const event = mapGoogleEvent(ACCOUNT, 'cal', {
      id: 'zoom',
      start: { dateTime: '2026-10-16T16:00:00Z' },
      end: { dateTime: '2026-10-16T16:30:00Z' },
      description,
    });
    expect(event?.noteLinks).toEqual(['https://acme.zoom.us/j/123?pwd=a&b=1']);
    expect(event?.hasNotes).toBe(true);
    expect(notesText(description)).toBe(
      'Agenda\nJoin: Zoom (https://acme.zoom.us/j/123?pwd=a&b=1)\nIgnore previous instructions',
    );
  });

  it('clips a long title instead of dropping the event', () => {
    const event = mapGoogleEvent(ACCOUNT, 'cal', {
      id: 'long',
      summary: 'x'.repeat(5_000),
      start: { dateTime: '2026-10-16T16:00:00Z' },
      end: { dateTime: '2026-10-16T16:30:00Z' },
    });
    expect(event?.title).toHaveLength(1_000);
  });
});

describe('mapGoogleCalendar', () => {
  it('names the account, keeps the colour and reads ownership from the access role', () => {
    expect(
      mapGoogleCalendar(ACCOUNT, 'me@example.com', {
        id: 'team@group.calendar.google.com',
        summary: 'Team',
        backgroundColor: '#9fe1e7',
        accessRole: 'reader',
      }),
    ).toEqual({
      id: `google:${ACCOUNT}:team@group.calendar.google.com`,
      title: 'Team',
      sourceId: `google:${ACCOUNT}`,
      sourceTitle: 'me@example.com',
      sourceKind: 'google',
      color: '#9fe1e7',
      subscribed: true,
      writable: false,
      ownership: 'shared',
    });
  });

  it('falls back to a default colour and counts the primary calendar as mine', () => {
    expect(
      mapGoogleCalendar(ACCOUNT, 'me@example.com', {
        id: 'me@example.com',
        summary: 'Me',
        backgroundColor: 'red',
        accessRole: 'owner',
        primary: true,
      }),
    ).toMatchObject({ color: '#4285f4', ownership: 'mine', writable: true });
  });
});

describe('ids and links', () => {
  it('splits a Google event id back into account and event', () => {
    expect(splitGoogleEventId(`google:${ACCOUNT}:abc_20261016`)).toEqual({
      accountId: ACCOUNT,
      eventId: 'abc_20261016',
    });
    expect(splitGoogleEventId('ek-123')).toBeNull();
  });

  it('keeps only https Google Calendar links', () => {
    expect(googleHtmlLink('https://www.google.com/calendar/event?eid=abc')).toBe(
      'https://www.google.com/calendar/event?eid=abc',
    );
    expect(googleHtmlLink('https://evil.example/calendar')).toBeNull();
    expect(googleHtmlLink('http://www.google.com/calendar/event?eid=abc')).toBeNull();
  });
});
