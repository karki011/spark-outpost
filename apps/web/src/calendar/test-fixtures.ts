import {
  CALENDAR_DEFAULT_SETTINGS,
  type CalendarChoice,
  type CalendarEvent,
  type CalendarStatus,
  type JoinLink,
} from '@spark-outpost/contracts';

export const WORK = '00000000-0000-4000-8000-0000000000a1';
export const FAMILY = '00000000-0000-4000-8000-0000000000a2';

export function at(hour: number, minute = 0, second = 0): number {
  return new Date(2026, 9, 16, hour, minute, second).getTime();
}

export function link(service: JoinLink['service'], host = 'acme.zoom.us'): JoinLink {
  return { url: `https://${host}/j/1`, host, service, unwrappedFrom: null };
}

let next = 0;

export function event(
  title: string,
  start: number,
  end: number,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  next += 1;
  return {
    key: `uid-${next}@${new Date(start).toISOString()}`,
    id: `id-${next}`,
    uid: `uid-${next}`,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    allDay: false,
    title,
    calendarKey: WORK,
    also: [],
    link: null,
    attendeeCount: 3,
    othersInvited: true,
    myStatus: 'accepted',
    availability: 'busy',
    recurring: false,
    hasNotes: false,
    busy: true,
    nudges: true,
    focus: false,
    remind: false,
    hold: false,
    ...overrides,
  };
}

export function choice(key: string, overrides: Partial<CalendarChoice> = {}): CalendarChoice {
  return {
    key,
    calendarId: `cal-${key}`,
    title: key === WORK ? 'Spark Work' : 'Spark Family',
    sourceId: 'local',
    sourceTitle: 'On My Mac',
    sourceKind: 'local',
    color: '#3366cc',
    writable: true,
    subscribed: false,
    ownership: 'mine',
    include: true,
    nudges: true,
    busy: true,
    ...overrides,
  };
}

export function status(overrides: Partial<CalendarStatus> = {}): CalendarStatus {
  return {
    supported: true,
    helper: 'ready',
    authorization: 'fullAccess',
    connected: true,
    accounts: [
      { id: 'local', title: 'On My Mac', kind: 'local', calendars: [choice(WORK), choice(FAMILY)] },
    ],
    notice: null,
    settings: CALENDAR_DEFAULT_SETTINGS,
    google: {
      available: true,
      testing: true,
      accounts: [],
      signIn: { status: 'idle', authorizeUrl: null, expiresAt: null, message: null },
    },
    ...overrides,
  };
}
