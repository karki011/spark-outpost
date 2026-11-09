import { remindUntil, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import type { Card } from './island-model.ts';

const MINUTE_MS = 60_000;
export const MEETING_FOCUS_MS = MINUTE_MS;
export const MEETING_STRIP_MS = 10 * MINUTE_MS;

export type HomeFocus =
  { kind: 'meeting'; events: CalendarEvent[] } | { kind: 'request' } | { kind: 'clear' };

function startOf(event: CalendarEvent): number {
  return spanOf(event).start;
}

export function meetingGroup(upcoming: readonly CalendarEvent[]): CalendarEvent[] {
  const first = upcoming[0];
  if (!first) return [];
  return upcoming.filter((event) => startOf(event) === startOf(first));
}

export function meetingIsOn(event: CalendarEvent, at: number): boolean {
  const span = spanOf(event);
  return span.start - at <= MEETING_FOCUS_MS && at < remindUntil(span);
}

export function homeFocus(
  cards: readonly Card[],
  upcoming: readonly CalendarEvent[],
  choosing: readonly CalendarEvent[] | null,
  at: number,
): HomeFocus {
  if (choosing && choosing.length > 0) return { kind: 'meeting', events: [...choosing] };
  const group = meetingGroup(upcoming.filter((event) => at < remindUntil(spanOf(event))));
  if (group[0] && meetingIsOn(group[0], at)) return { kind: 'meeting', events: group };
  return cards.length > 0 ? { kind: 'request' } : { kind: 'clear' };
}

export function soonMeeting(upcoming: readonly CalendarEvent[], at: number): CalendarEvent | null {
  const next = upcoming[0];
  if (!next) return null;
  const ahead = startOf(next) - at;
  return ahead > 0 && ahead <= MEETING_STRIP_MS ? next : null;
}

export function afterMeeting(
  upcoming: readonly CalendarEvent[],
  event: CalendarEvent,
): CalendarEvent | null {
  return upcoming.find((other) => startOf(other) > startOf(event)) ?? null;
}

export function minutesAhead(event: CalendarEvent, at: number): number {
  return Math.max(0, Math.ceil((startOf(event) - at) / MINUTE_MS));
}

export function startsIn(event: CalendarEvent, at: number): string {
  const minutes = minutesAhead(event, at);
  return minutes === 0 ? 'now' : `in ${minutes} min`;
}

export function leadProgress(event: CalendarEvent, at: number): number {
  const ahead = startOf(event) - at;
  return Math.min(1, Math.max(0, 1 - ahead / MEETING_STRIP_MS));
}

export function pageOf(index: number, total: number): number {
  if (total === 0) return 0;
  return ((index % total) + total) % total;
}
