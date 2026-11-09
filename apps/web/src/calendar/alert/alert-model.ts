import {
  CALENDAR_SERVICE_NAMES,
  joinOpen,
  meetingAlertPayloadSchema,
  meetingAlertPlaceSchema,
  spanOf,
  type CalendarEvent,
  type MeetingAlertPayload,
  type MeetingAlertPlace,
} from '@spark-outpost/contracts';
import { clock, span } from '../calendar-format.ts';

const MINUTE_MS = 60_000;
const CARD_HALF = 200;
const EDGE = 16;
const LANDING = 0.4;

export function parsePayload(value: unknown): MeetingAlertPayload | null {
  const parsed = meetingAlertPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parsePlace(value: unknown): MeetingAlertPlace | null {
  const parsed = meetingAlertPlaceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function startsPhrase(event: CalendarEvent, at: number, many: boolean): string {
  const start = spanOf(event).start;
  const verb = many ? 'start' : 'starts';
  const ahead = Math.ceil((start - at) / MINUTE_MS);
  if (ahead > 0) return `${verb} in ${ahead} min`;
  const since = Math.floor((at - start) / MINUTE_MS);
  return since < 1 ? `${verb} now` : `started ${since} min ago`;
}

export function alertTitle(events: readonly CalendarEvent[], at: number): string {
  const [first] = events;
  if (!first) return '';
  if (events.length === 1) return `${first.title} ${startsPhrase(first, at, false)}`;
  return `${events.length} meetings ${startsPhrase(first, at, true)}`;
}

export function alertDetail(event: CalendarEvent): string {
  const { start, end } = spanOf(event);
  const service = event.link ? CALENDAR_SERVICE_NAMES[event.link.service] : null;
  const people = event.attendeeCount > 1 ? `${event.attendeeCount} people` : null;
  return [span(start, end), service, people].filter(Boolean).join(' · ');
}

const NOTICE_MAX = 400;

export function alertNotice(events: readonly CalendarEvent[]): { title: string; body: string } {
  const [first] = events;
  if (!first) return { title: '', body: '' };
  const title =
    events.length === 1
      ? first.title
      : `${events.length} meetings: ${events.map((event) => event.title).join(', ')}`;
  return { title: title.slice(0, NOTICE_MAX), body: alertDetail(first).slice(0, NOTICE_MAX) };
}

export function joinState(
  event: CalendarEvent,
  at: number,
  leadMs: number,
): 'open' | 'later' | 'none' {
  if (!event.link) return 'none';
  const window = spanOf(event);
  if (joinOpen(window, at, leadMs)) return 'open';
  return at < window.end ? 'later' : 'none';
}

export function shortcutJoin(
  events: readonly CalendarEvent[],
  at: number,
  leadMs: number,
): CalendarEvent | null {
  const open = events.filter((event) => joinState(event, at, leadMs) === 'open');
  return open.length === 1 ? open[0]! : null;
}

export function joinOpensAt(event: CalendarEvent, leadMs: number): string {
  return clock(spanOf(event).start - leadMs);
}

export interface Rig {
  x: number;
  top: number;
  drop: number;
}

export function rigFor(place: MeetingAlertPlace): Rig {
  const x = Math.min(Math.max(place.anchorX, CARD_HALF + EDGE), place.width - CARD_HALF - EDGE);
  return { x, top: place.top, drop: Math.round(place.height * LANDING) - place.top };
}

export function countdownSeconds(deadline: number, at: number): number {
  return Math.max(0, Math.ceil((deadline - at) / 1000));
}
