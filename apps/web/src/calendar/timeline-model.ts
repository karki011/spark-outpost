import { spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import type { TimelineSpan } from './today-model.ts';

export const HOUR_PX = 84;
const MIN_EVENT_PX = 24;

export interface Placed {
  event: CalendarEvent;
  lane: number;
  lanes: number;
  span: number;
}

function overlaps(a: CalendarEvent, b: CalendarEvent): boolean {
  const first = spanOf(a);
  const second = spanOf(b);
  return first.start < second.end && second.start < first.end;
}

function lanesFree(item: Placed, group: readonly Placed[], lanes: number): number {
  let span = 1;
  const taken = (lane: number) =>
    group.some((other) => other.lane === lane && overlaps(other.event, item.event));
  while (item.lane + span < lanes && !taken(item.lane + span)) span += 1;
  return span;
}

function settle(group: Placed[], lanes: number): Placed[] {
  return group.map((item) => ({ ...item, lanes, span: lanesFree(item, group, lanes) }));
}

export function placeEvents(events: readonly CalendarEvent[]): Placed[] {
  const sorted = events
    .filter((event) => !event.allDay)
    .toSorted((a, b) => spanOf(a).start - spanOf(b).start || spanOf(b).end - spanOf(a).end);
  const placed: Placed[] = [];
  let group: Placed[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  for (const event of sorted) {
    const { start, end } = spanOf(event);
    if (start >= groupEnd && group.length > 0) {
      placed.push(...settle(group, laneEnds.length));
      group = [];
      laneEnds = [];
    }
    const free = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds[lane] = end;
    group.push({ event, lane, lanes: 1, span: 1 });
    groupEnd = group.length === 1 ? end : Math.max(groupEnd, end);
  }
  placed.push(...settle(group, laneEnds.length));
  return placed;
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
