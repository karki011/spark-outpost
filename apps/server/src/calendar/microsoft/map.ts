import {
  CALENDAR_ATTENDEES_MAX,
  MICROSOFT_EVENT_ID_PREFIX,
  type CalendarMyStatus,
  type HelperCalendar,
  type HelperEvent,
} from '@spark-outpost/contracts';
import type { Invitee } from '../people.ts';
import { noteLinks } from '../cloud/notes.ts';
import type { GraphCalendar, GraphEvent } from './api.ts';

const DEFAULT_COLOR = '#0078d4';
const ID_MAX = 300;
const EVENT_ID_MAX = 500;
const LINK_MAX = 2_000;
const WEB_LINK_HOSTS = new Set(['outlook.office365.com', 'outlook.office.com', 'outlook.live.com']);

export const microsoftSourceId = (accountId: string) => `microsoft:${accountId}`;

export function microsoftCalendarId(accountId: string, calendarId: string): string {
  return `microsoft:${accountId}:${calendarId}`;
}

export function microsoftEventId(accountId: string, eventId: string): string {
  return `${MICROSOFT_EVENT_ID_PREFIX}${accountId}:${eventId}`;
}

export function splitMicrosoftEventId(id: string): { accountId: string; eventId: string } | null {
  if (!id.startsWith(MICROSOFT_EVENT_ID_PREFIX)) return null;
  const rest = id.slice(MICROSOFT_EVENT_ID_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  return { accountId: rest.slice(0, colon), eventId: rest.slice(colon + 1) };
}

const clip = (value: string | null | undefined, max: number) =>
  value ? value.slice(0, max) : null;

const sameAddress = (a: string | null | undefined, b: string) =>
  Boolean(a) && a!.trim().toLowerCase() === b.trim().toLowerCase();

export function mapMicrosoftCalendar(
  accountId: string,
  email: string,
  entry: GraphCalendar,
): HelperCalendar | null {
  const id = microsoftCalendarId(accountId, entry.id);
  if (id.length > ID_MAX) return null;
  const mine = entry.isDefaultCalendar === true || sameAddress(entry.owner?.address, email);
  const color = entry.hexColor ?? '';
  return {
    id,
    title: (entry.name ?? entry.id).slice(0, 300),
    sourceId: microsoftSourceId(accountId),
    sourceTitle: email.slice(0, 300),
    sourceKind: 'microsoft',
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLOR,
    subscribed: false,
    writable: entry.canEdit === true,
    ownership: mine ? 'mine' : 'shared',
  };
}

function localMidnight(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year!, month! - 1, day!).toISOString();
}

const UTC_ZONES = new Set(['utc', 'etc/utc', 'coordinated universal time']);
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?)$/;

function instantOf(
  when: GraphEvent['start'],
  allDay: boolean,
): { at: string; allDay: boolean } | null {
  const match = when ? LOCAL_DATE_TIME.exec(when.dateTime) : null;
  if (!match) return null;
  if (allDay) return { at: localMidnight(match[1]!), allDay: true };
  if (!UTC_ZONES.has((when?.timeZone ?? 'UTC').toLowerCase())) return null;
  const parsed = Date.parse(`${match[1]}T${match[2]!.slice(0, 12)}Z`);
  return Number.isNaN(parsed) ? null : { at: new Date(parsed).toISOString(), allDay: false };
}

const RESPONSE: Record<string, CalendarMyStatus> = {
  organizer: 'accepted',
  accepted: 'accepted',
  declined: 'declined',
  tentativelyAccepted: 'tentative',
  notResponded: 'pending',
  none: 'pending',
};

export function microsoftNotes(event: GraphEvent): string | undefined {
  return event.body?.content ?? undefined;
}

function meetingUrl(event: GraphEvent): string | null {
  return clip(event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl, LINK_MAX);
}

function humans(event: GraphEvent, email: string) {
  return (event.attendees ?? [])
    .filter((attendee) => attendee.type !== 'resource')
    .map((attendee) => ({
      me: sameAddress(attendee.emailAddress?.address, email),
      address: attendee.emailAddress?.address ?? null,
    }));
}

export function microsoftOthers(event: GraphEvent, email: string): number {
  const invited = humans(event, email);
  const organizer = event.organizer?.emailAddress?.address ?? null;
  const organizerOther =
    organizer !== null &&
    !sameAddress(organizer, email) &&
    !invited.some((person) => sameAddress(person.address, organizer));
  return invited.filter((person) => !person.me).length + (organizerOther ? 1 : 0);
}

function people(event: GraphEvent, email: string) {
  const invited = humans(event, email);
  const others = microsoftOthers(event, email);
  const myStatus: CalendarMyStatus =
    others === 0 ? 'none' : (RESPONSE[event.responseStatus?.response ?? ''] ?? 'pending');
  return { attendeeCount: invited.length, othersInvited: others > 0, myStatus };
}

export interface MicrosoftEventContext {
  accountId: string;
  calendarId: string;
  email: string;
  seriesUid: string | null;
}

export function mapMicrosoftEvent(
  context: MicrosoftEventContext,
  event: GraphEvent,
): HelperEvent | null {
  if (event.isCancelled) return null;
  const allDay = event.isAllDay === true;
  const start = instantOf(event.start, allDay);
  const end = instantOf(event.end, allDay);
  const id = microsoftEventId(context.accountId, event.id);
  if (!start || !end || id.length > EVENT_ID_MAX) return null;
  const rawUid = event.seriesMasterId ? context.seriesUid : (event.iCalUId ?? null);
  const uid = rawUid && rawUid.length <= EVENT_ID_MAX ? rawUid : null;
  const notes = microsoftNotes(event);
  return {
    id,
    uid,
    start: start.at,
    end: end.at,
    allDay,
    title: (event.subject?.trim() || '(No title)').slice(0, 1_000),
    calendarId: microsoftCalendarId(context.accountId, context.calendarId),
    url: meetingUrl(event),
    location: clip(event.location?.displayName, LINK_MAX),
    noteLinks: noteLinks(notes),
    hasNotes: Boolean(notes?.trim()),
    ...people(event, context.email),
    availability: event.showAs === 'free' ? 'free' : 'busy',
    recurring:
      Boolean(event.seriesMasterId) || (event.type ?? 'singleInstance') !== 'singleInstance',
  };
}

export function microsoftInvitees(event: GraphEvent, email: string): Invitee[] {
  return (event.attendees ?? []).slice(0, CALENDAR_ATTENDEES_MAX * 2).map((attendee) => ({
    name: (attendee.emailAddress?.name ?? '').slice(0, 300),
    email: attendee.emailAddress?.address?.slice(0, 300) ?? null,
    isMe: sameAddress(attendee.emailAddress?.address, email),
    room: attendee.type === 'resource',
  }));
}

export function microsoftWebLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const ok = url.protocol === 'https:' && WEB_LINK_HOSTS.has(url.hostname) && !url.username;
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
}
