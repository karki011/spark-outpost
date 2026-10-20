import {
  CALENDAR_ATTENDEES_MAX,
  CALENDAR_NOTE_LINKS_MAX,
  GOOGLE_EVENT_ID_PREFIX,
  type CalendarMyStatus,
  type HelperCalendar,
  type HelperEvent,
} from '@spark-outpost/contracts';
import type { Invitee } from '../people.ts';
import { decodeEntities, htmlNotesText } from '../notes-html.ts';
import { linkFreeSnippet } from '../snippet.ts';
import type { GoogleCalendarEntry, GoogleEvent } from './api.ts';

const DEFAULT_COLOR = '#4285f4';
const ID_MAX = 300;
const EVENT_ID_MAX = 500;
const LINK_MAX = 2_000;
const NOTES_MAX = 20_000;
const HTML_LINK_HOSTS = new Set(['www.google.com', 'calendar.google.com']);

export const googleSourceId = (accountId: string) => `google:${accountId}`;

export function googleCalendarId(accountId: string, calendarId: string): string {
  return `google:${accountId}:${calendarId}`;
}

export function googleEventId(accountId: string, eventId: string): string {
  return `${GOOGLE_EVENT_ID_PREFIX}${accountId}:${eventId}`;
}

export function splitGoogleEventId(id: string): { accountId: string; eventId: string } | null {
  if (!id.startsWith(GOOGLE_EVENT_ID_PREFIX)) return null;
  const rest = id.slice(GOOGLE_EVENT_ID_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  return { accountId: rest.slice(0, colon), eventId: rest.slice(colon + 1) };
}

const clip = (value: string | undefined, max: number) =>
  value === undefined ? null : value.slice(0, max);

export function mapGoogleCalendar(
  accountId: string,
  email: string,
  entry: GoogleCalendarEntry,
): HelperCalendar | null {
  const id = googleCalendarId(accountId, entry.id);
  if (id.length > ID_MAX) return null;
  const mine = entry.primary === true || entry.accessRole === 'owner';
  const color = entry.backgroundColor ?? '';
  return {
    id,
    title: (entry.summaryOverride ?? entry.summary ?? entry.id).slice(0, 300),
    sourceId: googleSourceId(accountId),
    sourceTitle: email.slice(0, 300),
    sourceKind: 'google',
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLOR,
    subscribed: entry.accessRole === 'reader',
    writable: entry.accessRole === 'owner' || entry.accessRole === 'writer',
    ownership: mine ? 'mine' : 'shared',
  };
}

function localMidnight(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year!, month! - 1, day!).toISOString();
}

function instantOf(when: GoogleEvent['start']): { at: string; allDay: boolean } | null {
  if (when?.dateTime) return { at: new Date(when.dateTime).toISOString(), allDay: false };
  if (when?.date) return { at: localMidnight(when.date), allDay: true };
  return null;
}

const RESPONSE: Record<string, CalendarMyStatus> = {
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentative',
  needsAction: 'pending',
};

export function notesText(description: string | undefined): string {
  if (!description) return '';
  return htmlNotesText(description).slice(0, NOTES_MAX);
}

export function notesSnippet(description: string | undefined): string {
  if (!description) return '';
  return linkFreeSnippet(htmlNotesText(description));
}

export function noteLinks(description: string | undefined): string[] {
  if (!description) return [];
  const decoded = decodeEntities(description);
  const found = decoded.match(/https:\/\/[^\s"'<>()]+/g) ?? [];
  return [...new Set(found)]
    .filter((link) => link.length <= LINK_MAX)
    .slice(0, CALENDAR_NOTE_LINKS_MAX);
}

function meetingUrl(event: GoogleEvent): string | null {
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video',
  );
  return clip(event.hangoutLink ?? video?.uri, LINK_MAX);
}

function people(event: GoogleEvent) {
  const humans = (event.attendees ?? []).filter((attendee) => !attendee.resource);
  const me = humans.find((attendee) => attendee.self);
  const myStatus: CalendarMyStatus = me ? (RESPONSE[me.responseStatus ?? ''] ?? 'pending') : 'none';
  return {
    attendeeCount: humans.length,
    othersInvited: humans.some((attendee) => !attendee.self),
    myStatus,
  };
}

export function mapGoogleEvent(
  accountId: string,
  calendarId: string,
  event: GoogleEvent,
): HelperEvent | null {
  if (event.status === 'cancelled') return null;
  const start = instantOf(event.start);
  const end = instantOf(event.end);
  const id = googleEventId(accountId, event.id);
  if (!start || !end || id.length > EVENT_ID_MAX) return null;
  const uid = event.iCalUID && event.iCalUID.length <= EVENT_ID_MAX ? event.iCalUID : null;
  return {
    id,
    uid,
    start: start.at,
    end: end.at,
    allDay: start.allDay,
    title: (event.summary?.trim() || '(No title)').slice(0, 1_000),
    calendarId: googleCalendarId(accountId, calendarId),
    url: meetingUrl(event),
    location: clip(event.location, LINK_MAX),
    noteLinks: noteLinks(event.description),
    hasNotes: Boolean(event.description?.trim()),
    ...people(event),
    availability: event.transparency === 'transparent' ? 'free' : 'busy',
    recurring: Boolean(event.recurringEventId || event.recurrence?.length),
  };
}

export function googleInvitees(attendees: GoogleEvent['attendees']): Invitee[] {
  return (attendees ?? []).slice(0, CALENDAR_ATTENDEES_MAX * 2).map((attendee) => ({
    name: (attendee.displayName ?? '').slice(0, 300),
    email: attendee.email?.slice(0, 300) ?? null,
    isMe: attendee.self === true,
    room: attendee.resource === true,
  }));
}

export function googleHtmlLink(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const ok = url.protocol === 'https:' && HTML_LINK_HOSTS.has(url.hostname) && !url.username;
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
}
