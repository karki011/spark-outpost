import { z } from 'zod';
import {
  calendarAvailabilitySchema,
  calendarMyStatusSchema,
  calendarOwnershipSchema,
  calendarSourceKindSchema,
  type HelperEvent,
} from './calendar-helper.ts';
import { joinLink, joinLinkSchema } from './calendar-join.ts';

export const CALENDAR_DAY_START_HOUR = 9;
export const CALENDAR_DAY_END_HOUR = 18;
export const CALENDAR_FREE_MIN_MS = 30 * 60_000;
export const CALENDAR_DEFAULT_FOCUS_NAMES = ['Focus', 'Deep work', 'Heads down'] as const;

export const calendarChoiceSchema = z.object({
  key: z.uuid(),
  calendarId: z.string().max(300),
  title: z.string().max(300),
  sourceId: z.string().max(300),
  sourceTitle: z.string().max(300),
  sourceKind: calendarSourceKindSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  writable: z.boolean(),
  subscribed: z.boolean(),
  ownership: calendarOwnershipSchema,
  include: z.boolean(),
  nudges: z.boolean(),
});
export type CalendarChoice = z.infer<typeof calendarChoiceSchema>;

export const calendarEventSchema = z.object({
  key: z.string().max(600),
  id: z.string().max(500),
  uid: z.string().max(500).nullable(),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  allDay: z.boolean(),
  title: z.string().max(1_000),
  calendarKey: z.uuid(),
  also: z.array(z.uuid()).max(50),
  link: joinLinkSchema.nullable(),
  attendeeCount: z.number().int().min(0),
  othersInvited: z.boolean(),
  myStatus: calendarMyStatusSchema,
  availability: calendarAvailabilitySchema,
  recurring: z.boolean(),
  hasNotes: z.boolean(),
  busy: z.boolean(),
  nudges: z.boolean(),
  focus: z.boolean(),
  remind: z.boolean(),
  hold: z.boolean(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export interface CalendarSpan {
  start: number;
  end: number;
}

export interface CalendarMarks {
  remind: ReadonlySet<string>;
  hold: ReadonlySet<string>;
}

export const NO_CALENDAR_MARKS: CalendarMarks = { remind: new Set(), hold: new Set() };

export function eventKey(event: { uid: string | null; id: string; start: string }): string {
  return `${event.uid ?? event.id}@${new Date(event.start).toISOString()}`;
}

export function isFocusTitle(title: string, focusNames: readonly string[]): boolean {
  const lower = title.trim().toLowerCase();
  return focusNames.some((name) => {
    const wanted = name.trim().toLowerCase();
    if (!wanted || !lower.startsWith(wanted)) return false;
    const next = lower.charAt(wanted.length);
    return next === '' || !/[a-z0-9]/.test(next);
  });
}

function countsAsBusy(event: HelperEvent): boolean {
  return !event.allDay && event.availability !== 'free' && event.myStatus !== 'declined';
}

interface MergeInput {
  events: readonly HelperEvent[];
  calendars: readonly CalendarChoice[];
  focusNames: readonly string[];
  marks: CalendarMarks;
}

function firstCopies(
  input: MergeInput,
): Map<string, { event: HelperEvent; copies: CalendarChoice[] }> {
  const included = input.calendars.filter((calendar) => calendar.include);
  const order = new Map(included.map((calendar, index) => [calendar.calendarId, index]));
  const byCalendar = new Map(included.map((calendar) => [calendar.calendarId, calendar]));
  const sorted = input.events
    .filter((event) => order.has(event.calendarId))
    .toSorted((a, b) => order.get(a.calendarId)! - order.get(b.calendarId)!);
  const merged = new Map<string, { event: HelperEvent; copies: CalendarChoice[] }>();
  for (const event of sorted) {
    const calendar = byCalendar.get(event.calendarId)!;
    const key = eventKey(event);
    const seen = merged.get(key);
    if (seen) seen.copies.push(calendar);
    else merged.set(key, { event, copies: [calendar] });
  }
  return merged;
}

export function mergeEvents(input: MergeInput): CalendarEvent[] {
  const result: CalendarEvent[] = [];
  for (const [key, { event, copies }] of firstCopies(input)) {
    const [first, ...rest] = copies;
    result.push({
      key,
      id: event.id,
      uid: event.uid,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      title: event.title,
      calendarKey: first!.key,
      also: rest.map((calendar) => calendar.key),
      link: joinLink(event),
      attendeeCount: event.attendeeCount,
      othersInvited: event.othersInvited,
      myStatus: event.myStatus,
      availability: event.availability,
      recurring: event.recurring,
      hasNotes: event.hasNotes,
      busy: countsAsBusy(event),
      nudges: copies.some((calendar) => calendar.nudges),
      focus: isFocusTitle(event.title, input.focusNames),
      remind: input.marks.remind.has(key),
      hold: input.marks.hold.has(key),
    });
  }
  return result.toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function spanOf(event: { start: string; end: string }): CalendarSpan {
  return { start: Date.parse(event.start), end: Date.parse(event.end) };
}

export function localDayStart(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function addLocalDays(dayStart: number, days: number): number {
  const day = new Date(dayStart);
  day.setDate(day.getDate() + days);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function workWindow(dayStart: number): CalendarSpan {
  const start = new Date(dayStart);
  start.setHours(CALENDAR_DAY_START_HOUR, 0, 0, 0);
  const end = new Date(dayStart);
  end.setHours(CALENDAR_DAY_END_HOUR, 0, 0, 0);
  return { start: start.getTime(), end: end.getTime() };
}

export function eventsOnDay<T extends { start: string; end: string }>(
  events: readonly T[],
  dayStart: number,
): T[] {
  const dayEnd = addLocalDays(dayStart, 1);
  return events.filter((event) => {
    const span = spanOf(event);
    return span.start < dayEnd && span.end > dayStart;
  });
}

function busySpans(events: readonly CalendarEvent[], window: CalendarSpan): CalendarSpan[] {
  return events
    .filter((event) => event.busy)
    .map(spanOf)
    .map((span) => ({
      start: Math.max(span.start, window.start),
      end: Math.min(span.end, window.end),
    }))
    .filter((span) => span.end > span.start)
    .toSorted((a, b) => a.start - b.start);
}

export function freeBlocks(events: readonly CalendarEvent[], dayStart: number): CalendarSpan[] {
  const window = workWindow(dayStart);
  const blocks: CalendarSpan[] = [];
  let cursor = window.start;
  for (const span of busySpans(events, window)) {
    if (span.start - cursor >= CALENDAR_FREE_MIN_MS)
      blocks.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (window.end - cursor >= CALENDAR_FREE_MIN_MS) blocks.push({ start: cursor, end: window.end });
  return blocks;
}

export const dayLoadSchema = z.enum(['Heavy', 'Balanced', 'Light', 'Clear']);
export type DayLoad = z.infer<typeof dayLoadSchema>;

export const dayShapeSchema = z.object({
  load: dayLoadSchema,
  meetingMinutes: z.number().int().min(0),
  focusMinutes: z.number().int().min(0),
  freeMinutes: z.number().int().min(0),
  bars: z.array(
    z.object({ start: z.number(), end: z.number(), kind: z.enum(['meeting', 'focus']) }),
  ),
});
export type DayShape = z.infer<typeof dayShapeSchema>;

function minutesOf(spans: readonly CalendarSpan[]): number {
  return Math.round(spans.reduce((total, span) => total + span.end - span.start, 0) / 60_000);
}

function loadOf(meetingMinutes: number): DayLoad {
  if (meetingMinutes >= 240) return 'Heavy';
  if (meetingMinutes >= 120) return 'Balanced';
  if (meetingMinutes > 0) return 'Light';
  return 'Clear';
}

export function dayShape(events: readonly CalendarEvent[], dayStart: number): DayShape {
  const window = workWindow(dayStart);
  const clip = (event: CalendarEvent) => {
    const span = spanOf(event);
    return { start: Math.max(span.start, window.start), end: Math.min(span.end, window.end) };
  };
  const busy = events.filter((event) => event.busy);
  const bars = busy
    .map((event) => ({
      ...clip(event),
      kind: event.focus ? ('focus' as const) : ('meeting' as const),
    }))
    .filter((bar) => bar.end > bar.start);
  const meetingMinutes = minutesOf(
    busySpans(
      busy.filter((event) => !event.focus),
      window,
    ),
  );
  const focusMinutes = minutesOf(
    busySpans(
      busy.filter((event) => event.focus),
      window,
    ),
  );
  return {
    load: loadOf(meetingMinutes),
    meetingMinutes,
    focusMinutes,
    freeMinutes: minutesOf(freeBlocks(events, dayStart)),
    bars,
  };
}

export function longestFree(blocks: readonly CalendarSpan[]): CalendarSpan | null {
  return blocks.reduce<CalendarSpan | null>(
    (best, block) => (!best || block.end - block.start > best.end - best.start ? block : best),
    null,
  );
}

export function isMeeting(event: CalendarEvent): boolean {
  return !event.focus && !event.allDay && event.myStatus !== 'declined';
}
