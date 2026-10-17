import { addLocalDays, eventsOnDay, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { clock, dateOf } from './calendar-format.ts';
import { localDate } from './use-calendar.ts';

export const GRID_WEEKS = 6;
export const WEEK_DAYS = 7;
export const CELL_TITLES = 3;

export interface MonthCell {
  date: string;
  dayStart: number;
  inMonth: boolean;
  past: boolean;
  today: boolean;
}

export interface MonthGridModel {
  year: number;
  month: number;
  from: string;
  to: string;
  weeks: MonthCell[][];
}

export function weekStartDay(locale?: string): number {
  try {
    const info = new Intl.Locale(locale ?? navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    return firstDay === undefined ? 0 : firstDay % 7;
  } catch {
    return 0;
  }
}

export function dayStartOf(date: string): number {
  return dateOf(date).getTime();
}

export function monthGrid(date: string, today: string, weekStart: number): MonthGridModel {
  const picked = new Date(dayStartOf(date));
  const year = picked.getFullYear();
  const month = picked.getMonth();
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + WEEK_DAYS) % WEEK_DAYS;
  const start = addLocalDays(first.getTime(), -lead);
  const todayStart = dayStartOf(today);
  const weeks = Array.from({ length: GRID_WEEKS }, (_, week) =>
    Array.from({ length: WEEK_DAYS }, (_, index): MonthCell => {
      const dayStart = addLocalDays(start, week * WEEK_DAYS + index);
      return {
        date: localDate(dayStart),
        dayStart,
        inMonth: new Date(dayStart).getMonth() === month,
        past: dayStart < todayStart,
        today: dayStart === todayStart,
      };
    }),
  );
  return {
    year,
    month,
    from: localDate(start),
    to: localDate(addLocalDays(start, GRID_WEEKS * WEEK_DAYS)),
    weeks,
  };
}

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return spanOf(a).start - spanOf(b).start;
}

export function dayEvents(events: readonly CalendarEvent[], date: string): CalendarEvent[] {
  return eventsOnDay(events, dayStartOf(date)).toSorted(byStart);
}

export function eventsByDay(
  events: readonly CalendarEvent[],
  cells: readonly MonthCell[],
): Map<string, CalendarEvent[]> {
  return new Map(cells.map((cell) => [cell.date, dayEvents(events, cell.date)]));
}

export function preview(events: readonly CalendarEvent[]): {
  shown: CalendarEvent[];
  more: number;
} {
  return { shown: events.slice(0, CELL_TITLES), more: Math.max(0, events.length - CELL_TITLES) };
}

export function shiftMonth(date: string, months: number): string {
  const day = new Date(dayStartOf(date));
  const target = new Date(day.getFullYear(), day.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day.getDate(), last));
  return localDate(target.getTime());
}

export function setMonth(date: string, year: number, month: number): string {
  const day = new Date(dayStartOf(date));
  const offset = (year - day.getFullYear()) * 12 + (month - day.getMonth());
  return shiftMonth(date, offset);
}

export function shiftDay(date: string, days: number): string {
  return localDate(addLocalDays(dayStartOf(date), days));
}

export function keyMove(key: string, date: string, weekStart: number): string | null {
  const weekday = (new Date(dayStartOf(date)).getDay() - weekStart + WEEK_DAYS) % WEEK_DAYS;
  switch (key) {
    case 'ArrowLeft':
      return shiftDay(date, -1);
    case 'ArrowRight':
      return shiftDay(date, 1);
    case 'ArrowUp':
      return shiftDay(date, -WEEK_DAYS);
    case 'ArrowDown':
      return shiftDay(date, WEEK_DAYS);
    case 'Home':
      return shiftDay(date, -weekday);
    case 'End':
      return shiftDay(date, WEEK_DAYS - 1 - weekday);
    case 'PageUp':
      return shiftMonth(date, -1);
    case 'PageDown':
      return shiftMonth(date, 1);
    default:
      return null;
  }
}

export interface TimeGroup {
  label: string;
  events: CalendarEvent[];
}

export function timeGroups(events: readonly CalendarEvent[], date: string): TimeGroup[] {
  const dayStart = dayStartOf(date);
  const groups: TimeGroup[] = [];
  for (const event of events.toSorted(byStart)) {
    const start = Math.max(spanOf(event).start, dayStart);
    const label = event.allDay ? 'All day' : clock(start - (start % (60 * 60_000)));
    const last = groups.at(-1);
    if (last?.label === label) last.events.push(event);
    else groups.push({ label, events: [event] });
  }
  return groups;
}

export function isPastEvent(event: CalendarEvent, now: number): boolean {
  return spanOf(event).end <= now;
}

export function durationMinutes(event: CalendarEvent): number {
  const { start, end } = spanOf(event);
  return Math.max(0, Math.round((end - start) / 60_000));
}

export function initials(name: string): string {
  const words = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words.at(-1)![0]] : [words[0]?.[0]];
  return letters.join('').toUpperCase();
}
