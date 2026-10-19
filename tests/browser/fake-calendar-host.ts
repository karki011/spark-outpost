import { readFileSync } from 'node:fs';
import {
  BROWSER_HOST_ENV,
  calendarBridgeToHostSchema,
  eventsInSpan,
  type CalendarAuthorization,
  type CalendarHostRequest,
  type HelperCalendar,
  type HelperEvent,
} from '../../packages/contracts/src/index.ts';
import {
  calendarClockOffset,
  saveCalendarClock,
  shiftProcessClock,
} from './fake-calendar-clock.ts';
import { busyEvents, type FakeDetail } from './fake-calendar-busy.ts';
import { FAKE_CALENDAR_FAR_DAYS } from './stub-config.ts';

type Listener = (event: { data: unknown }) => void;

interface FakeState {
  authorization?: CalendarAuthorization;
  grant?: CalendarAuthorization;
  helper?: 'ready' | 'missing' | 'failed';
  anchor?: number;
  familyTitle?: string;
  clash?: boolean;
  busy?: boolean;
}

const listeners = new Set<Listener>();
const MINUTE = 60_000;
const clockOffset = calendarClockOffset(Date.now());
shiftProcessClock(clockOffset);
if (process.env.SPARK_FAKE_CALENDAR_STATE) {
  saveCalendarClock(process.env.SPARK_FAKE_CALENDAR_STATE, clockOffset);
}
const startedAt = Math.floor(Date.now() / MINUTE) * MINUTE;
let granted: CalendarAuthorization | null = null;

const CALENDARS: HelperCalendar[] = [
  {
    id: 'fake-work',
    title: 'Spark Work',
    sourceId: 'fake-local',
    sourceTitle: 'On My Mac',
    sourceKind: 'local',
    color: '#1f7a8c',
    subscribed: false,
    writable: true,
    ownership: 'mine',
  },
  {
    id: 'fake-family',
    title: 'Spark Family',
    sourceId: 'fake-icloud',
    sourceTitle: 'iCloud',
    sourceKind: 'caldav',
    color: '#b5476b',
    subscribed: false,
    writable: true,
    ownership: 'unknown',
  },
];

const DAY_MINUTES = 24 * 60;

const details = new Map<string, FakeDetail>();

function state(): FakeState {
  const file = process.env.SPARK_FAKE_CALENDAR_STATE;
  if (!file) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as FakeState;
  } catch {
    return {};
  }
}

function authorization(): CalendarAuthorization {
  return granted ?? state().authorization ?? 'fullAccess';
}

function iso(at: number): string {
  return new Date(at).toISOString();
}

function event(
  id: string,
  title: string,
  calendarId: string,
  start: number,
  minutes: number,
  extra: Partial<HelperEvent> & Partial<FakeDetail> = {},
): HelperEvent {
  const { notes = '', attendees = [], ...fields } = extra;
  details.set(id, { notes, attendees });
  return {
    id,
    uid: `uid-${id}`,
    start: iso(start),
    end: iso(start + minutes * MINUTE),
    allDay: false,
    title,
    calendarId,
    url: null,
    location: null,
    noteLinks: [],
    hasNotes: notes !== '',
    attendeeCount: 3,
    othersInvited: true,
    myStatus: 'accepted',
    availability: 'busy',
    recurring: false,
    ...fields,
  };
}

function dayStartOf(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function anchor(): number {
  return state().anchor ?? startedAt;
}

function tomorrowAt(hours: number): number {
  const day = new Date(anchor());
  day.setDate(day.getDate() + 1);
  day.setHours(hours, 0, 0, 0);
  return day.getTime();
}

function clashEvents(at: (minutes: number) => number): HelperEvent[] {
  return [
    event('clash-standup', 'Standup', 'fake-work', at(6), 15, {
      noteLinks: ['https://acme.zoom.us/j/123456789'],
    }),
    event('clash-design', 'Design sync', 'fake-work', at(6), 30, {
      url: 'https://meet.google.com/abc-defg-hij',
    }),
    event('clash-room', 'Room booking', 'fake-family', at(6), 30),
    event('clash-customer', 'Customer call', 'fake-work', at(60), 30),
    event('clash-vendor', 'Vendor sync', 'fake-work', at(75), 30, {
      url: 'https://meet.google.com/xyz-abcd-efg',
    }),
  ];
}

function events(): HelperEvent[] {
  const start = anchor();
  const at = (minutes: number) => start + minutes * MINUTE;
  if (state().clash) return clashEvents(at);
  if (state().busy) return busyEvents(event, start, dayStartOf(start));
  const safeLinks = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent(
    'https://teams.microsoft.com/l/meetup-join/19%3ameeting_fake/0',
  )}`;
  return [
    event('standup', 'Standup', 'fake-work', at(4), 15, {
      noteLinks: ['https://acme.zoom.us/j/123456789'],
      notes: 'Daily sync: what changed since yesterday.',
      attendees: [
        { name: 'Spark Tester', isMe: true, status: 'accepted' },
        { name: 'Alex Wong', isMe: false, status: 'accepted' },
        { name: 'Ivan Marsh', isMe: false, status: 'tentative' },
      ],
    }),
    event('customer', 'Customer call', 'fake-work', at(60), 30, { noteLinks: [safeLinks] }),
    event('vendor', 'Vendor sync', 'fake-work', at(90), 30, {
      url: 'https://meet.google.com/abc-defg-hij',
    }),
    event('focus', 'Focus: dashboards', 'fake-work', at(130), 60, {
      attendeeCount: 0,
      othersInvited: false,
      myStatus: 'none',
    }),
    event('pickup', 'School pickup', 'fake-family', at(200), 15, {
      attendeeCount: 0,
      othersInvited: false,
      myStatus: 'none',
    }),
    event('shared-work', 'Shared invite', 'fake-work', at(240), 30, { uid: 'uid-shared' }),
    event('shared-family', 'Shared invite', 'fake-family', at(240), 30, { uid: 'uid-shared' }),
    event('holiday', 'Company holiday', 'fake-family', dayStartOf(start), 24 * 60, {
      allDay: true,
      attendeeCount: 0,
      othersInvited: false,
      myStatus: 'none',
      availability: 'free',
    }),
    event('demo', 'Demo day', 'fake-work', tomorrowAt(15), 60, {
      url: 'https://meet.google.com/xyz-abcd-efg',
    }),
    event('review', 'Quarterly review', 'fake-work', at(-FAKE_CALENDAR_FAR_DAYS * DAY_MINUTES), 60),
    event('board', 'Board prep', 'fake-family', at(FAKE_CALENDAR_FAR_DAYS * DAY_MINUTES), 60),
  ];
}

function window() {
  const from = anchor() - 2 * DAY_MINUTES * MINUTE;
  const to = anchor() + 8 * DAY_MINUTES * MINUTE;
  return {
    events: eventsInSpan(events(), from, to),
    truncated: false,
    from: iso(from),
    to: iso(to),
  };
}

function failure(code: string, message: string) {
  return { ok: false as const, code, message };
}

function answer(request: CalendarHostRequest): unknown {
  const helper = state().helper ?? 'ready';
  if (request.op === 'status') {
    return helper === 'ready'
      ? { helper, authorization: authorization() }
      : { helper, authorization: null };
  }
  if (request.op === 'open_settings') return { opened: true };
  if (request.op === 'stop') {
    granted = null;
    return { stopped: true };
  }
  if (helper !== 'ready') return failure('missing', "The calendar helper isn't available.");
  if (request.op === 'request') {
    granted = state().grant ?? 'fullAccess';
    return { authorization: granted };
  }
  if (authorization() !== 'fullAccess') return failure('not_authorized', 'No calendar access.');
  if (request.op === 'calendars') {
    const familyTitle = state().familyTitle;
    return {
      calendars: CALENDARS.map((calendar) =>
        familyTitle && calendar.id === 'fake-family'
          ? { ...calendar, title: familyTitle }
          : calendar,
      ),
    };
  }
  if (request.op === 'window') return window();
  if (request.op === 'range') {
    const inside = eventsInSpan(events(), Date.parse(request.from), Date.parse(request.to));
    return { events: inside, truncated: false };
  }
  if (request.op === 'open') return { opened: true };
  const found = events().find((item) => item.id === request.eventId);
  if (!found) return failure('not_found', 'That event is gone.');
  const detail = details.get(found.id);
  return {
    event: found,
    notes: detail?.notes ?? '',
    attendees: detail?.attendees ?? [],
    organizerIsMe: false,
  };
}

function reply(raw: unknown) {
  const parsed = calendarBridgeToHostSchema.safeParse(raw);
  if (!parsed.success || parsed.data.kind !== 'calendar:request') return;
  const { id, request } = parsed.data;
  const result = answer(request);
  const failed = (result as { ok?: boolean }).ok === false;
  const message = failed
    ? { kind: 'calendar:response', id, ...(result as object) }
    : { kind: 'calendar:response', id, ok: true, result };
  queueMicrotask(() => {
    for (const listener of listeners) listener({ data: message });
  });
}

process.env[BROWSER_HOST_ENV] = '1';
Object.defineProperty(process, 'parentPort', {
  configurable: true,
  value: {
    postMessage: reply,
    on: (_event: 'message', listener: Listener) => listeners.add(listener),
  },
});
