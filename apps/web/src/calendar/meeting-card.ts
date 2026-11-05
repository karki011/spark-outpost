import {
  CALENDAR_SERVICE_NAMES,
  spanOf,
  type CalendarEvent,
  type CalendarPerson,
} from '@spark-outpost/contracts';
import { duration, span } from './calendar-format.ts';

const MINUTE_MS = 60_000;
const PEOPLE_SHOWN = 3;
const AGENDA_CHARS = 180;
const COMPACT_SCREEN = 1280;
const ROOM = /(^|\b)(room|conf(erence)?\s+room|boardroom)\b/i;
const ROOM_EMAIL = /@resource\.calendar\.google\.com$|^room[-_.]|@rooms?\./i;
const URL_TEXT = /https?:\/\/\S+/gi;
const BOILERPLATE = [
  /^join (zoom|microsoft teams|google meet|webex)/i,
  /^(meeting|webinar) id\b/i,
  /^pass(code|word)\b/i,
  /^one tap mobile/i,
  /^dial[- ]?(by|in)\b/i,
  /^find your local number/i,
  /^(or )?call in/i,
  /^join by (phone|sip|h\.323)/i,
  /^[-_=─—*~.]{3,}$/,
  /^\+?[\d\s,#*()-]{8,}$/,
];

export function startsLabel(event: CalendarEvent, at: number): string {
  const start = spanOf(event).start;
  const ahead = Math.ceil((start - at) / MINUTE_MS);
  if (ahead > 0) return `In ${ahead} min`;
  const since = Math.floor((at - start) / MINUTE_MS);
  return since < 1 ? 'Now' : `Started ${since} min ago`;
}

export function timeRow(event: CalendarEvent): string {
  const { start, end } = spanOf(event);
  const minutes = Math.round((end - start) / MINUTE_MS);
  return `${span(start, end)} · ${duration(minutes)}`;
}

export function placeRow(
  event: CalendarEvent,
  calendarName: string | null,
  location: string | null,
): string {
  const where = event.link ? CALENDAR_SERVICE_NAMES[event.link.service] : location?.trim() || null;
  return [where, calendarName].filter(Boolean).join(' · ');
}

export function isRoom(person: CalendarPerson): boolean {
  return ROOM.test(person.name) || (person.email !== null && ROOM_EMAIL.test(person.email));
}

export function peopleRow(people: readonly CalendarPerson[]): string | null {
  const names = people.filter((person) => !isRoom(person)).map((person) => person.name.trim());
  const shown = names.filter(Boolean);
  if (shown.length === 0) return null;
  const rest = shown.length - PEOPLE_SHOWN;
  const head = shown.slice(0, PEOPLE_SHOWN).join(', ');
  return rest > 0 ? `${head} +${rest}` : head;
}

export function agendaPreview(text: string): string | null {
  const lines = text
    .replace(URL_TEXT, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && !BOILERPLATE.some((rule) => rule.test(line)));
  const joined = lines.join(' ').trim();
  if (!joined) return null;
  return joined.length > AGENDA_CHARS ? `${joined.slice(0, AGENDA_CHARS - 1).trimEnd()}…` : joined;
}

export function compactCard(screenWidth: number, stacked: boolean): boolean {
  return stacked || screenWidth < COMPACT_SCREEN;
}

export function joinLabel(event: CalendarEvent): string {
  return event.link ? `Join ${CALENDAR_SERVICE_NAMES[event.link.service]}` : 'Join';
}
