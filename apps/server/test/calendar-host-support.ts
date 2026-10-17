import {
  eventsInSpan,
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
  ranges: { from: string; to: string }[];
  authorization: CalendarAuthorization;
  grant: CalendarAuthorization;
  calendars: HelperCalendar[];
  events: HelperEvent[];
  helper: 'ready' | 'missing';
}

export function fakeHost(): FakeHost {
  const host = {
    calls: [] as CalendarHostRequest['op'][],
    ranges: [] as { from: string; to: string }[],
    authorization: 'notDetermined' as CalendarAuthorization,
    grant: 'fullAccess' as CalendarAuthorization,
    calendars: [
      helperCalendar('work-1', 'Work', 'On My Mac'),
      helperCalendar('fam-1', 'Family', 'iCloud'),
    ],
    events: [] as HelperEvent[],
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
        const events = eventsInSpan(host.events, Date.parse(request.from), Date.parse(request.to));
        return { events, truncated: false };
      }
      if (request.op === 'stop') return { stopped: true };
      if (request.op === 'open') return { opened: true };
      if (request.op === 'event') {
        throw new CalendarHostError('not_found', 'That event is gone.');
      }
      return { opened: true };
    },
  };
  return host as unknown as FakeHost;
}
