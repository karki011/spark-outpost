import {
  CALENDAR_CAPTURE_WINDOW_MS,
  CALENDAR_REMIND_MINUTES,
  CALENDAR_UPCOMING_COUNT,
  addLocalDays,
  isMeeting,
  localDayStart,
  spanOf,
  type CalendarCapture,
  type CalendarEvent,
  type CalendarHold,
  type CalendarNudge,
  type CalendarSettings,
} from '@spark-outpost/contracts';

export interface PlannerChat {
  id: string;
  title: string;
  running: boolean;
  needsYou: boolean;
}

export interface Plan {
  upcoming: CalendarEvent[];
  nudge: CalendarNudge | null;
  hold: CalendarHold | null;
  capture: CalendarCapture | null;
}

export const NOW_GRACE_MS = 5 * 60_000;
const MINUTE = 60_000;
const WRAP_UP_CHATS = 3;

function isToday(event: CalendarEvent, now: number): boolean {
  const today = localDayStart(now);
  const { start } = spanOf(event);
  return start >= today && start < addLocalDays(today, 1);
}

function answered(event: CalendarEvent): boolean {
  return event.myStatus === 'accepted' || event.myStatus === 'pending' || event.myStatus === 'none';
}

function nudgeable(event: CalendarEvent, now: number): boolean {
  return event.nudges && isMeeting(event) && answered(event) && isToday(event, now);
}

function minutesUntil(start: number, now: number): number {
  return Math.max(0, Math.ceil((start - now) / MINUTE));
}

function base(event: CalendarEvent) {
  return { eventKey: event.key, title: event.title, startsAt: event.start };
}

function remindNudge(events: readonly CalendarEvent[], now: number): CalendarNudge | null {
  const event = events.find((candidate) => {
    const { start } = spanOf(candidate);
    return candidate.remind && now >= start - CALENDAR_REMIND_MINUTES * MINUTE && now < start;
  });
  if (!event) return null;
  return { kind: 'remind', ...base(event), minutes: minutesUntil(spanOf(event).start, now) };
}

function beforeNudge(
  events: readonly CalendarEvent[],
  settings: CalendarSettings,
  now: number,
): CalendarNudge | null {
  const event = events.find((candidate) => {
    const { start } = spanOf(candidate);
    return (
      nudgeable(candidate, now) &&
      now >= start - settings.beforeMinutes * MINUTE &&
      now < start + NOW_GRACE_MS
    );
  });
  if (!event) return null;
  return { kind: 'before', ...base(event), minutes: minutesUntil(spanOf(event).start, now) };
}

function wrapUpNudge(
  events: readonly CalendarEvent[],
  chats: readonly PlannerChat[],
  settings: CalendarSettings,
  now: number,
): CalendarNudge | null {
  if (settings.wrapUpMinutes === 0) return null;
  const busyChats = chats
    .filter((chat) => chat.running || chat.needsYou)
    .slice(0, WRAP_UP_CHATS)
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      reason: chat.running ? ('running' as const) : ('needs_you' as const),
    }));
  if (busyChats.length === 0) return null;
  const event = events.find((candidate) => {
    const { start } = spanOf(candidate);
    return (
      nudgeable(candidate, now) &&
      now >= start - settings.wrapUpMinutes * MINUTE &&
      now < start - settings.beforeMinutes * MINUTE
    );
  });
  if (!event) return null;
  return {
    kind: 'wrap_up',
    ...base(event),
    minutes: minutesUntil(spanOf(event).start, now),
    chats: busyChats,
  };
}

function holds(event: CalendarEvent, settings: CalendarSettings): boolean {
  if (event.hold) return true;
  if (event.allDay || event.myStatus === 'declined') return false;
  if (settings.holdRule === 'focus') return event.focus;
  if (settings.holdRule === 'meetings') return event.focus || event.busy;
  return false;
}

export function activeHold(
  events: readonly CalendarEvent[],
  settings: CalendarSettings,
  now: number,
): CalendarHold | null {
  const current = events
    .filter((event) => {
      const { start, end } = spanOf(event);
      return start <= now && now < end && holds(event, settings);
    })
    .toSorted((a, b) => spanOf(b).end - spanOf(a).end);
  const event = current[0];
  if (!event) return null;
  return { eventKey: event.key, title: event.title, until: event.end, focus: event.focus };
}

function captureOffer(
  events: readonly CalendarEvent[],
  settings: CalendarSettings,
  now: number,
): CalendarCapture | null {
  if (!settings.capture) return null;
  const ended = events
    .filter((event) => {
      const { end } = spanOf(event);
      return (
        isMeeting(event) && event.hasNotes && end <= now && now < end + CALENDAR_CAPTURE_WINDOW_MS
      );
    })
    .toSorted((a, b) => spanOf(b).end - spanOf(a).end);
  const event = ended[0];
  if (!event) return null;
  return { eventKey: event.key, eventId: event.id, start: event.start, title: event.title };
}

export function upcomingMeetings(events: readonly CalendarEvent[], now: number): CalendarEvent[] {
  return events
    .filter((event) => isMeeting(event) && isToday(event, now) && spanOf(event).end > now)
    .slice(0, CALENDAR_UPCOMING_COUNT);
}

export function planNudges(
  events: readonly CalendarEvent[],
  chats: readonly PlannerChat[],
  settings: CalendarSettings,
  now: number,
): Plan {
  const sorted = events.toSorted((a, b) => spanOf(a).start - spanOf(b).start);
  return {
    upcoming: upcomingMeetings(sorted, now),
    nudge:
      remindNudge(sorted, now) ??
      beforeNudge(sorted, settings, now) ??
      wrapUpNudge(sorted, chats, settings, now),
    hold: activeHold(sorted, settings, now),
    capture: captureOffer(sorted, settings, now),
  };
}

export function meetingPushDue(
  events: readonly CalendarEvent[],
  settings: CalendarSettings,
  now: number,
): CalendarEvent[] {
  return events.filter((event) => {
    const { start } = spanOf(event);
    return nudgeable(event, now) && now >= start - settings.beforeMinutes * MINUTE && now < start;
  });
}
