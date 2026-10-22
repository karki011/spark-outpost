import { useEffect, useMemo, useState } from 'react';
import { spanOf, type CalendarEvent } from '@spark-outpost/contracts';

const LATE_MS = 50;
const MINUTE_MS = 60_000;
export const COUNTDOWN_LEAD_MS = 60 * MINUTE_MS;
const NO_SPANS: readonly CountdownSpan[] = [];

function spanOfKey(key: string): CountdownSpan {
  const [start, end] = key.split('/').map(Number);
  return { start: start!, end: end! };
}

export function nextBoundary(times: readonly number[], now: number): number | null {
  const ahead = times.filter((time) => time > now);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

export function eventEnds(events: readonly CalendarEvent[]): number[] {
  return events.map((event) => spanOf(event).end);
}

export interface CountdownSpan {
  start: number;
  end: number;
}

export function countdownSpans(events: readonly CalendarEvent[]): CountdownSpan[] {
  return events.filter((event) => !event.allDay).map((event) => spanOf(event));
}

export function nextMinuteMark(spans: readonly CountdownSpan[], now: number): number | null {
  const marks = spans.flatMap(({ start, end }) => {
    const from = start - COUNTDOWN_LEAD_MS;
    if (now < from) return [from];
    const mark = start + (Math.floor((now - start) / MINUTE_MS) + 1) * MINUTE_MS;
    return mark < end ? [mark] : [];
  });
  return marks.length === 0 ? null : Math.min(...marks);
}

export function hasEnded(event: CalendarEvent, now: number): boolean {
  return spanOf(event).end <= now;
}

export function stillOn<T extends CalendarEvent>(events: readonly T[], now: number): T[] {
  return events.filter((event) => !hasEnded(event, now));
}

function nextWake(
  boundaries: readonly number[],
  spans: readonly CountdownSpan[],
  now: number,
): number | null {
  const wakes = [nextBoundary(boundaries, now), nextMinuteMark(spans, now)];
  const ahead = wakes.filter((wake) => wake !== null);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

export function useEventClock(
  times: readonly number[],
  refreshedAt = 0,
  spans: readonly CountdownSpan[] = NO_SPANS,
): number {
  const [now, setNow] = useState(Date.now);
  const key = useMemo(() => [...new Set(times)].sort((a, b) => a - b).join(','), [times]);
  const spanKey = spans.map(({ start, end }) => `${start}/${end}`).join(',');
  useEffect(() => {
    const reread = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(reread);
  }, [key, refreshedAt]);
  useEffect(() => {
    const boundaries = key === '' ? [] : key.split(',').map(Number);
    const check = () => setNow(Date.now());
    const bounds = spanKey === '' ? [] : spanKey.split(',').map(spanOfKey);
    const next = nextWake(boundaries, bounds, Date.now());
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
  }, [key, spanKey, now]);
  return now;
}
