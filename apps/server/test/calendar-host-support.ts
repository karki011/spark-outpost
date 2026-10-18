import {
  CALENDAR_EVENTS_MAX,
  eventsInSpan,
  type HelperEventDetail,
  type CalendarAuthorization,
  type CalendarHostRequest,
  type HelperCalendar,
  type HelperEvent,
} from '@spark-outpost/contracts';
import { CalendarHostError, type CalendarHost } from '../src/calendar/host-client.ts';

export const MINUTE = 60_000;

export function helperCalendar(id: string, title: string, sourceTitle: string): HelperCalendar {
  return {
    id,
    title,
    sourceId: `src-${sourceTitle}`,
    sourceTitle,
    sourceKind: 'local',
    color: '#336699',
    subscribed: false,
    writable: true,
    ownership: 'mine',
  };
}

export function helperEvent(
  id: string,
  calendarId: string,
  startIn: number,
  extra: Partial<HelperEvent> = {},
) {
  const start = Date.now() + startIn * MINUTE;
  return {
    id,
    uid: `uid-${id}`,
    start: new Date(start).toISOString(),
    end: new Date(start + 15 * MINUTE).toISOString(),
    allDay: false,
    title: id,
    calendarId,
    url: null,
    location: null,
    noteLinks: [],
    hasNotes: false,
    attendeeCount: 2,
    othersInvited: true,
    myStatus: 'accepted',
    availability: 'busy',
    recurring: false,
    ...extra,
  } satisfies HelperEvent;
}

export interface FakeHost extends CalendarHost {
  calls: CalendarHostRequest['op'][];
  writes: CalendarHostRequest[];
  details: Map<string, Omit<HelperEventDetail, 'event'>>;
  ranges: { from: string; to: string }[];
  detail: HelperEventDetail | null;
  authorization: CalendarAuthorization;
  grant: CalendarAuthorization;
  calendars: HelperCalendar[];
  events: HelperEvent[];
  helper: 'ready' | 'missing';
}

export function fakeHost(): FakeHost {
  const host = {
    calls: [] as CalendarHostRequest['op'][],
    writes: [] as CalendarHostRequest[],
    details: new Map<string, Omit<HelperEventDetail, 'event'>>(),
    ranges: [] as { from: string; to: string }[],
    authorization: 'notDetermined' as CalendarAuthorization,
    grant: 'fullAccess' as CalendarAuthorization,
    calendars: [
      helperCalendar('work-1', 'Work', 'On My Mac'),
      helperCalendar('fam-1', 'Family', 'iCloud'),
    ],
    events: [] as HelperEvent[],
    detail: null as HelperEventDetail | null,
    helper: 'ready' as 'ready' | 'missing',
    onChanged: () => undefined,
    request: async (request: CalendarHostRequest) => {
      host.calls.push(request.op);
      if (request.op === 'status') {
        return host.helper === 'ready'
          ? { helper: 'ready', authorization: host.authorization }
          : { helper: 'missing', authorization: null };
      }
      if (request.op === 'request') {
        host.authorization = host.grant;
        return { authorization: host.authorization };
      }
      if (request.op === 'calendars') return { calendars: host.calendars };
      if (request.op === 'window') {
        return {
          events: host.events,
          truncated: false,
          from: '2026-01-01T00:00:00Z',
          to: '2027-01-01T00:00:00Z',
        };
      }
      if (request.op === 'range') {
        host.ranges.push({ from: request.from, to: request.to });
        const inside = eventsInSpan(
          host.events,
          Date.parse(request.from),
          Date.parse(request.to),
        ).toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
        return {
          events: inside.slice(0, CALENDAR_EVENTS_MAX),
          truncated: inside.length > CALENDAR_EVENTS_MAX,
        };
      }
      if (request.op === 'stop') return { stopped: true };
      if (request.op === 'open') return { opened: true };
      if (request.op === 'event') {
        if (host.detail) return host.detail;
        const found = occurrenceOf(host, request.eventId, request.start);
        const extra = found ? host.details.get(found.id) : undefined;
        if (found && extra) return { event: found, ...extra };
        throw new CalendarHostError('not_found', 'That event is gone.');
      }
      if (request.op === 'save' || request.op === 'remove') {
        host.writes.push(request);
        return request.op === 'save' ? saved(host, request) : removed(host, request);
      }
      return { opened: true };
    },
  };
  return host as unknown as FakeHost;
}

function occurrenceOf(host: FakeHost, eventId: string, start: string): HelperEvent | undefined {
  return host.events.find(
    (event) => event.id === eventId && Date.parse(event.start) === Date.parse(start),
  );
}

function detailOf(host: FakeHost, event: HelperEvent): HelperEventDetail {
  const extra = host.details.get(event.id) ?? {
    notes: '',
    attendees: [],
    organizerIsMe: true,
    alarms: [],
  };
  return { event, ...extra };
}

function saved(host: FakeHost, request: Extract<CalendarHostRequest, { op: 'save' }>) {
  const { fields } = request;
  const before = request.eventId
    ? occurrenceOf(host, request.eventId, request.occurrence ?? '')
    : undefined;
  if (request.eventId && !before) throw new CalendarHostError('not_found', 'That event is gone.');
  const after: HelperEvent = {
    ...(before ??
      helperEvent(`new-${host.writes.length}`, request.calendarId, 0, {
        attendeeCount: 0,
        othersInvited: false,
        myStatus: 'none',
      })),
    ...(fields.title !== undefined ? { title: fields.title } : {}),
    ...(fields.start !== undefined ? { start: fields.start } : {}),
    ...(fields.end !== undefined ? { end: fields.end } : {}),
    ...(fields.location !== undefined ? { location: fields.location || null } : {}),
  };
  const beforeDetail = before ? detailOf(host, before) : null;
  host.events = [...host.events.filter((event) => event !== before), after];
  host.details.set(after.id, {
    ...(beforeDetail ?? { notes: '', attendees: [], organizerIsMe: true }),
    ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
    alarms:
      fields.alarmMinutes === undefined
        ? (beforeDetail?.alarms ?? [])
        : fields.alarmMinutes === null
          ? []
          : [fields.alarmMinutes],
  });
  return { before: beforeDetail, after: detailOf(host, after) };
}

function removed(host: FakeHost, request: Extract<CalendarHostRequest, { op: 'remove' }>) {
  const found = occurrenceOf(host, request.eventId, request.start);
  if (!found) throw new CalendarHostError('not_found', 'That event is gone.');
  host.events = host.events.filter((event) => event !== found);
  return { removed: true };
}
