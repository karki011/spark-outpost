import { spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import type { TimelineSpan } from './today-model.ts';

export const HOUR_PX = 84;
const MIN_EVENT_PX = 24;

export interface Placed {
  event: CalendarEvent;
  lane: number;
  lanes: number;
}

export function placeEvents(events: readonly CalendarEvent[]): Placed[] {
  const sorted = events
    .filter((event) => !event.allDay)
    .toSorted((a, b) => spanOf(a).start - spanOf(b).start || spanOf(b).end - spanOf(a).end);
  const laneEnds: number[] = [];
  const placed = sorted.map((event) => {
    const { start, end } = spanOf(event);
    const free = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds[lane] = end;
    return { event, lane, lanes: 1 };
  });
  return placed.map((item) => {
    const { start, end } = spanOf(item.event);
    const overlapping = placed.filter((other) => {
      const span = spanOf(other.event);
      return span.start < end && span.end > start;
    });
    return { ...item, lanes: Math.max(...overlapping.map((other) => other.lane)) + 1 };
  });
}

export function offset(at: number, span: TimelineSpan): number {
  const clamped = Math.min(Math.max(at, span.start), span.end);
  return ((clamped - span.start) / 3_600_000) * HOUR_PX;
}

export function block(start: number, end: number, span: TimelineSpan) {
  const top = offset(start, span);
  return { top, height: Math.max(MIN_EVENT_PX, offset(end, span) - top) };
}

export function hourMarks(span: TimelineSpan): number[] {
  const marks: number[] = [];
  for (let at = span.start; at <= span.end; at += 3_600_000) marks.push(at);
  return marks;
}
