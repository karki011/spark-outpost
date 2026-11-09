import { isMeeting, spanOf, type CalendarEvent } from './calendar.ts';
import { joinOpen } from './calendar-join.ts';

export interface CalendarClash {
  eventKey: string;
  titles: string[];
}

export function meetingsOverlap(a: CalendarEvent, b: CalendarEvent): boolean {
  if (a.key === b.key || !isMeeting(a) || !isMeeting(b)) return false;
  const first = spanOf(a);
  const second = spanOf(b);
  return first.start < second.end && second.start < first.end;
}

export function clashesOf(event: CalendarEvent, events: readonly CalendarEvent[]): CalendarEvent[] {
  return events.filter((other) => meetingsOverlap(event, other));
}

export function clashList(
  events: readonly CalendarEvent[],
  among: readonly CalendarEvent[],
): CalendarClash[] {
  return events
    .map((event) => ({
      eventKey: event.key,
      titles: clashesOf(event, among).map((other) => other.title),
    }))
    .filter((clash) => clash.titles.length > 0);
}

export function clashText(titles: readonly string[]): string | null {
  if (titles.length === 0) return null;
  if (titles.length === 1) return `clashes with ${titles[0]}`;
  return `clashes with ${titles.length} meetings`;
}

export function joinableMeetings(
  events: readonly CalendarEvent[],
  now: number,
  leadMs: number,
): CalendarEvent[] {
  const seen = new Set<string>();
  return events
    .filter((event) => {
      if (!event.link || seen.has(event.key) || !joinOpen(spanOf(event), now, leadMs)) {
        return false;
      }
      seen.add(event.key);
      return true;
    })
    .toSorted((a, b) => spanOf(a).start - spanOf(b).start);
}
