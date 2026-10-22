import { useEffect, useMemo, useState } from 'react';
import { spanOf, type CalendarEvent } from '@spark-outpost/contracts';

const LATE_MS = 50;
const MINUTE_MS = 60_000;
export const COUNTDOWN_LEAD_MS = 60 * MINUTE_MS;

export function nextBoundary(times: readonly number[], now: number): number | null {
  const ahead = times.filter((time) => time > now);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

export function eventEnds(events: readonly CalendarEvent[]): number[] {
  return events.map((event) => spanOf(event).end);
}

export function minuteMarks(events: readonly CalendarEvent[]): number[] {
  return events.flatMap((event) => {
    if (event.allDay) return [];
    const { start, end } = spanOf(event);
    const marks: number[] = [];
    for (let mark = start - COUNTDOWN_LEAD_MS; mark < end; mark += MINUTE_MS) marks.push(mark);
    return marks;
  });
}

export function hasEnded(event: CalendarEvent, now: number): boolean {
  return spanOf(event).end <= now;
}

export function stillOn<T extends CalendarEvent>(events: readonly T[], now: number): T[] {
  return events.filter((event) => !hasEnded(event, now));
}

export function useEventClock(times: readonly number[], refreshedAt = 0): number {
  const [now, setNow] = useState(Date.now);
  const key = useMemo(() => [...new Set(times)].sort((a, b) => a - b).join(','), [times]);
  useEffect(() => {
    const reread = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(reread);
  }, [key, refreshedAt]);
  useEffect(() => {
    const boundaries = key === '' ? [] : key.split(',').map(Number);
    const check = () => setNow(Date.now());
    const next = nextBoundary(boundaries, Date.now());
    const timer = next === null ? undefined : setTimeout(check, next - Date.now() + LATE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, now]);
  return now;
}
