import {
  joinableMeetings,
  remindUntil,
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
  const span = spanOf(event);
  const from = span.start - input.settings.alertLead * MINUTE_MS;
  return (
    input.at >= from && input.at < remindUntil(span) && !quieted(input.marks, event.key, input.at)
  );
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
  joinLeadMs: number;
}

export type AutoJoinPlan = { join: CalendarEvent } | { skip: AutoJoinSkip };

function startedNow(event: CalendarEvent, at: number): boolean {
  const { start, end } = spanOf(event);
  return at >= start && at < end;
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

function away(presence: Presence): boolean {
  return presence.locked || presence.asleep || presence.idleSeconds > AWAY_SECONDS;
}

function requestedJoin(input: AutoJoinInput): AutoJoinPlan | null {
  const asked = input.events.filter(
    (event) => event.joinAtStart && startedNow(event, input.at) && !input.joined.has(event.key),
  );
  if (asked.length === 0) return null;
  if (away(input.presence)) return { skip: 'away' };
  const verdicts = asked.map((event) => ({ event, skip: skipFor(event, input) }));
  const ready = verdicts.filter((verdict) => verdict.skip === null);
  if (ready.length > 1) return { skip: 'clash' };
  const chosen = ready[0] ?? verdicts.at(-1)!;
  return chosen.skip ? { skip: chosen.skip } : { join: chosen.event };
}

export function autoJoinPlan(input: AutoJoinInput): AutoJoinPlan {
  const asked = requestedJoin(input);
  if (asked && ('join' in asked || !input.autoJoin)) return asked;
  if (!input.autoJoin) return { skip: 'off' };
  if (input.held) return { skip: 'held' };
  if (away(input.presence)) return { skip: 'away' };
  const started = input.events.filter((event) => startedNow(event, input.at));
  if (started.length === 0) return { skip: 'none' };
  const open = joinableMeetings(input.events, input.at, input.joinLeadMs).filter(
    (event) => !input.joined.has(event.key) && !input.marks.get(event.key)?.dismissed,
  );
  if (open.length > 1) return { skip: 'clash' };
  const verdicts = started.map((event) => ({ event, skip: skipFor(event, input) }));
  const ready = verdicts.filter((verdict) => verdict.skip === null);
  if (ready.length > 1) return { skip: 'clash' };
  const chosen = ready[0] ?? verdicts.at(-1);
  if (!chosen) return { skip: 'none' };
  return chosen.skip ? { skip: chosen.skip } : { join: chosen.event };
}
