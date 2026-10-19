import {
  joinableMeetings,
  spanOf,
  type CalendarEvent,
  type CalendarNow,
  type CalendarSettings,
} from '@spark-outpost/contracts';
import type { NudgeMarks } from './nudge-marks.ts';

const MINUTE_MS = 60_000;
export const AUTO_JOIN_COUNTDOWN_MS = 10_000;
export const AUTO_JOIN_LATE_MS = 2 * MINUTE_MS;
export const AWAY_SECONDS = 5 * 60;

export interface MeetingAlert {
  key: string;
  events: CalendarEvent[];
}

export interface MeetingAlertInput {
  now: CalendarNow | null;
  settings: Pick<CalendarSettings, 'alertStyle' | 'alertLead'>;
  at: number;
  held: boolean;
  marks: NudgeMarks;
}

function quieted(marks: NudgeMarks, eventKey: string, at: number): boolean {
  const mark = marks.get(eventKey);
  if (!mark) return false;
  return mark.dismissed || (mark.snoozedUntil !== null && at < mark.snoozedUntil);
}

function alerting(event: CalendarEvent, input: MeetingAlertInput): boolean {
  if (event.allDay || !event.nudges || event.myStatus === 'declined') return false;
  const { start, end } = spanOf(event);
  const from = start - input.settings.alertLead * MINUTE_MS;
  return input.at >= from && input.at < end && !quieted(input.marks, event.key, input.at);
}

export function meetingAlert(input: MeetingAlertInput): MeetingAlert | null {
  if (input.settings.alertStyle !== 'center' || input.held || !input.now?.active) return null;
  const due = input.now.upcoming.filter((event) => alerting(event, input));
  if (due.length === 0) return null;
  const first = Math.min(...due.map((event) => spanOf(event).start));
  const events = due
    .filter((event) => spanOf(event).start === first)
    .toSorted((a, b) => a.title.localeCompare(b.title));
  return { key: events.map((event) => event.key).join('|'), events };
}

interface ShownLine {
  eventKey: string | null;
  choose: readonly CalendarEvent[] | null;
}

export function lineUnderAlert(line: ShownLine, alert: MeetingAlert | null): boolean {
  if (!alert) return false;
  const keys = new Set(alert.events.map((event) => event.key));
  if (line.eventKey !== null && keys.has(line.eventKey)) return true;
  return line.choose?.some((event) => keys.has(event.key)) ?? false;
}

export interface Presence {
  idleSeconds: number;
  locked: boolean;
  asleep: boolean;
}

export type AutoJoinSkip =
  | 'off'
  | 'held'
  | 'away'
  | 'none'
  | 'clash'
  | 'declined'
  | 'dismissed'
  | 'late'
  | 'all-day'
  | 'joined'
  | 'no-link';

export interface AutoJoinInput {
  events: readonly CalendarEvent[];
  autoJoin: boolean;
  at: number;
  held: boolean;
  marks: NudgeMarks;
  presence: Presence;
  joined: ReadonlySet<string>;
}

export type AutoJoinPlan = { join: CalendarEvent } | { skip: AutoJoinSkip };

function startedNow(event: CalendarEvent, at: number): boolean {
  const start = spanOf(event).start;
  return at >= start && at < spanOf(event).end;
}

function skipFor(event: CalendarEvent, input: AutoJoinInput): AutoJoinSkip | null {
  if (event.allDay) return 'all-day';
  if (!event.link) return 'no-link';
  if (event.myStatus === 'declined') return 'declined';
  if (input.marks.get(event.key)?.dismissed) return 'dismissed';
  if (input.joined.has(event.key)) return 'joined';
  if (input.at - spanOf(event).start > AUTO_JOIN_LATE_MS) return 'late';
  return null;
}

export function autoJoinPlan(input: AutoJoinInput): AutoJoinPlan {
  if (!input.autoJoin) return { skip: 'off' };
  if (input.held) return { skip: 'held' };
  const { presence } = input;
  if (presence.locked || presence.asleep || presence.idleSeconds > AWAY_SECONDS) {
    return { skip: 'away' };
  }
  const started = input.events.filter((event) => startedNow(event, input.at));
  if (started.length === 0) return { skip: 'none' };
  if (joinableMeetings(input.events, input.at).length > 1) return { skip: 'clash' };
  const [event] = started;
  if (started.length > 1 || !event) return { skip: 'clash' };
  const skip = skipFor(event, input);
  return skip ? { skip } : { join: event };
}
