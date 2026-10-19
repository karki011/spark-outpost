import {
  CALENDAR_DAY_END_HOUR,
  CALENDAR_SERVICE_NAMES,
  clashList,
  isMeeting,
  joinOpen,
  JOIN_LEAD_MS,
  spanOf,
  type CalendarChoice,
  type CalendarEvent,
  type CalendarStatus,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { isRunning } from '../conversations/row-state.ts';
import { countLabel } from '../ui/count-label.ts';
import { clock, duration, minutesUntil } from './calendar-format.ts';

export type TodayState = 'web' | 'helper' | 'denied' | 'connect' | 'none' | 'ready';

const OVERLAP_LEAD_MS = 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const TIMELINE_START_HOUR = 8;

export function calendarMap(
  choices: readonly CalendarChoice[] | undefined,
): Map<string, CalendarChoice> {
  return new Map((choices ?? []).map((choice) => [choice.key, choice]));
}

export function clashMap(
  events: readonly CalendarEvent[] | undefined,
): Map<string, readonly string[]> {
  const day = events ?? [];
  return new Map(clashList(day, day).map((clash) => [clash.eventKey, clash.titles]));
}

export function includedCalendars(status: CalendarStatus): number {
  return status.accounts.reduce(
    (total, account) => total + account.calendars.filter((calendar) => calendar.include).length,
    0,
  );
}

export function macState(status: CalendarStatus): TodayState {
  if (status.helper === 'missing' || status.helper === 'failed') return 'helper';
  const access = status.authorization;
  if (access === 'denied' || access === 'restricted' || access === 'writeOnly') return 'denied';
  if (!status.connected) return 'connect';
  return 'ready';
}

export function todayState(status: CalendarStatus): TodayState {
  if (!status.supported) return 'web';
  if (status.google.accounts.length === 0) {
    const mac = macState(status);
    if (mac !== 'ready') return mac;
  }
  if (includedCalendars(status) === 0) return 'none';
  return 'ready';
}

export const CALENDAR_TAGLINE =
  'See today’s meetings, get a nudge before they start, join in one click.';

const STATE_LINE: Record<Exclude<TodayState, 'ready' | 'none'>, string> = {
  web: 'Lives in the Mac app',
  helper: 'The calendar helper isn’t available',
  denied: 'Calendars access is off for Spark Outpost',
  connect: CALENDAR_TAGLINE,
};

export function hasCalendarSource(status: CalendarStatus): boolean {
  return status.connected || status.google.accounts.length > 0;
}

export function nextMeeting(
  upcoming: readonly CalendarEvent[] | undefined,
  now: number,
): CalendarEvent | null {
  return (upcoming ?? []).find((event) => spanOf(event).start > now) ?? null;
}

export function connectorLine(
  status: CalendarStatus,
  next: CalendarEvent | null = null,
  now = Date.now(),
): { state: TodayState; text: string } {
  const state = todayState(status);
  if (!hasCalendarSource(status)) return { state, text: CALENDAR_TAGLINE };
  if (state !== 'ready' && state !== 'none') return { state, text: STATE_LINE[state] };
  const included = includedCalendars(status);
  const parts = [
    included === 0 ? 'No calendars included' : countLabel(included, 'calendar'),
    ...(next ? [`next: ${next.title} ${countdown(next, now)}`] : []),
    ...(status.google.accounts.some((account) => account.state === 'sign_in_again')
      ? ['Sign in again']
      : []),
  ];
  return { state, text: parts.join(' · ') };
}

export function upcomingMeetings(events: readonly CalendarEvent[], now: number): CalendarEvent[] {
  return events.filter((event) => isMeeting(event) && event.nudges && spanOf(event).end > now);
}

export function countdown(event: CalendarEvent, now: number): string {
  const start = spanOf(event).start;
  if (start <= now) return 'now';
  return `in ${duration(minutesUntil(start, now))}`;
}

export function overlapChat(
  event: CalendarEvent,
  now: number,
  chats: readonly ConversationSummary[],
): ConversationSummary | null {
  if (!isMeeting(event)) return null;
  const { start, end } = spanOf(event);
  const soon = end > now && start - now <= OVERLAP_LEAD_MS;
  if (!soon) return null;
  return chats.find((chat) => !chat.archivedAt && isRunning(chat)) ?? null;
}

export interface NoGap {
  at: number;
  text: string;
}

export function noGaps(events: readonly CalendarEvent[]): NoGap[] {
  const calls = events
    .filter((event) => isMeeting(event) && event.link)
    .toSorted((a, b) => spanOf(a).start - spanOf(b).start);
  const gaps: NoGap[] = [];
  for (let index = 1; index < calls.length; index += 1) {
    const before = calls[index - 1]!;
    const after = calls[index]!;
    if (spanOf(before).end !== spanOf(after).start) continue;
    if (before.link!.service === after.link!.service) continue;
    gaps.push({
      at: spanOf(after).start,
      text: `no gap: ${CALENDAR_SERVICE_NAMES[before.link!.service]} → ${CALENDAR_SERVICE_NAMES[after.link!.service]}`,
    });
  }
  return gaps;
}

export function visibleEvents(
  events: readonly CalendarEvent[],
  hidden: ReadonlySet<string>,
): CalendarEvent[] {
  return events.flatMap((event) => {
    const shown = [event.calendarKey, ...event.also].filter((key) => !hidden.has(key));
    const [first, ...rest] = shown;
    return first ? [{ ...event, calendarKey: first, also: rest }] : [];
  });
}

export interface TimelineSpan {
  start: number;
  end: number;
}

function atHour(dayStart: number, hour: number): number {
  const time = new Date(dayStart);
  time.setHours(hour, 0, 0, 0);
  return time.getTime();
}

export function timelineSpan(
  dayStart: number,
  dayEnd: number,
  events: readonly CalendarEvent[],
): TimelineSpan {
  const timed = events.filter((event) => !event.allDay);
  const starts = timed.map((event) => Math.max(dayStart, spanOf(event).start));
  const ends = timed.map((event) => Math.min(dayEnd, spanOf(event).end));
  const earliest = Math.min(atHour(dayStart, TIMELINE_START_HOUR), ...starts);
  const latest = Math.max(atHour(dayStart, CALENDAR_DAY_END_HOUR), ...ends);
  const start = dayStart + Math.floor((earliest - dayStart) / HOUR_MS) * HOUR_MS;
  const end = Math.min(dayEnd, dayStart + Math.ceil((latest - dayStart) / HOUR_MS) * HOUR_MS);
  return { start, end };
}

export function joinTarget(events: readonly CalendarEvent[], now: number): CalendarEvent | null {
  return (
    events
      .filter((event) => event.link && joinOpen(spanOf(event), now))
      .toSorted((a, b) => spanOf(a).start - spanOf(b).start)[0] ?? null
  );
}

export function joinHint(event: CalendarEvent, now: number): string | null {
  const opensAt = spanOf(event).start - JOIN_LEAD_MS;
  return now < opensAt ? `from ${clock(opensAt)}` : null;
}

export function openJoin(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}
