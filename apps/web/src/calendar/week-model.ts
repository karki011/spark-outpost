import { addLocalDays, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { dateOf } from './calendar-format.ts';
import { WEEK_DAYS, type MonthCell } from './month-model.ts';
import { timelineSpan, type TimelineSpan } from './today-model.ts';
import { localDate } from './use-calendar.ts';

export const WEEK_HOUR_PX = 56;
const MIN_BLOCK_PX = 20;
const HOUR_MS = 3_600_000;
const TWO_LINE_PX = 38;

export interface WeekModel {
  from: string;
  to: string;
  days: MonthCell[];
  shown: MonthCell[];
}

function isWeekend(dayStart: number): boolean {
  const day = new Date(dayStart).getDay();
  return day === 0 || day === 6;
}

export function weekModel(
  date: string,
  today: string,
  weekStart: number,
  weekends: boolean,
): WeekModel {
  const picked = dateOf(date).getTime();
  const lead = (new Date(picked).getDay() - weekStart + WEEK_DAYS) % WEEK_DAYS;
  const first = addLocalDays(picked, -lead);
  const todayStart = dateOf(today).getTime();
  const days = Array.from({ length: WEEK_DAYS }, (_, index): MonthCell => {
    const dayStart = addLocalDays(first, index);
    return {
      date: localDate(dayStart),
      dayStart,
      inMonth: true,
      past: dayStart < todayStart,
      today: dayStart === todayStart,
    };
  });
  return {
    from: localDate(first),
    to: localDate(addLocalDays(first, WEEK_DAYS)),
    days,
    shown: weekends ? days : days.filter((day) => !isWeekend(day.dayStart)),
  };
}

export interface WeekHours {
  start: number;
  end: number;
}

export function weekHours(
  days: readonly MonthCell[],
  byDay: ReadonlyMap<string, readonly CalendarEvent[]>,
): WeekHours {
  let start = 24;
  let end = 0;
  for (const day of days) {
    const span = timelineSpan(
      day.dayStart,
      addLocalDays(day.dayStart, 1),
      byDay.get(day.date) ?? [],
    );
    start = Math.min(start, new Date(span.start).getHours());
    end = Math.max(
      end,
      Math.round((span.end - span.start) / HOUR_MS) + new Date(span.start).getHours(),
    );
  }
  return start < end ? { start, end } : { start: 8, end: 18 };
}

function atHour(dayStart: number, hour: number): number {
  if (hour >= 24) return addLocalDays(dayStart, 1);
  const time = new Date(dayStart);
  time.setHours(hour, 0, 0, 0);
  return time.getTime();
}

export function daySpan(dayStart: number, hours: WeekHours): TimelineSpan {
  return { start: atHour(dayStart, hours.start), end: atHour(dayStart, hours.end) };
}

export function weekOffset(at: number, span: TimelineSpan): number {
  const clamped = Math.min(Math.max(at, span.start), span.end);
  return ((clamped - span.start) / HOUR_MS) * WEEK_HOUR_PX;
}

export function weekBlock(event: CalendarEvent, span: TimelineSpan) {
  const { start, end } = spanOf(event);
  const top = weekOffset(start, span);
  const height = Math.max(MIN_BLOCK_PX, weekOffset(end, span) - top);
  return { top, height, twoLines: height >= TWO_LINE_PX };
}

export function weekTitle(shown: readonly MonthCell[]): string {
  const first = shown[0];
  const last = shown.at(-1);
  if (!first || !last) return '';
  const month = (at: number, year: boolean) =>
    new Date(at).toLocaleDateString(
      undefined,
      year ? { month: 'long', year: 'numeric' } : { month: 'long' },
    );
  const sameMonth = new Date(first.dayStart).getMonth() === new Date(last.dayStart).getMonth();
  return sameMonth
    ? month(first.dayStart, true)
    : `${month(first.dayStart, false)} – ${month(last.dayStart, true)}`;
}
