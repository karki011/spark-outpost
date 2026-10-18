import type {
  CalendarCapture,
  CalendarEvent,
  CalendarNow,
  CalendarNudge,
} from '@spark-outpost/contracts';
import type { Chime } from '../island/island-sound.ts';
import { countLabel } from '../ui/count-label.ts';
import { clock, minutesUntil } from './calendar-format.ts';
import { joinTarget } from './today-model.ts';

export interface HeldTally {
  needs: number;
  done: number;
  failed: number;
}

export const NO_HELD: HeldTally = { needs: 0, done: 0, failed: 0 };

export interface CatchUp {
  label: string;
  tally: HeldTally;
}

export type CalendarLineKind = 'nudge' | 'hold' | 'catch-up' | 'capture' | 'join';

export interface CalendarLine {
  kind: CalendarLineKind;
  key: string;
  eventKey: string | null;
  text: string;
  join: CalendarEvent | null;
  choose: CalendarEvent[] | null;
  capture: CalendarCapture | null;
  dismiss: 'catch_up' | 'capture' | null;
}

export interface CalendarLineInput {
  now: CalendarNow | null;
  at: number;
  waiting: number;
  catchUp: CatchUp | null;
  dismissed: ReadonlySet<string>;
}

export function tallyHeld(tally: HeldTally, chime: Chime): HeldTally {
  return { ...tally, [chime]: tally[chime] + 1 };
}

export function catchUpText(catchUp: CatchUp): string | null {
  const { needs, done, failed } = catchUp.tally;
  const parts = [
    needs > 0 ? `${countLabel(needs, 'chat needs', 'chats need')} you` : null,
    done > 0 ? `${done} finished` : null,
    failed > 0 ? `${failed} failed` : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  return `While you were in ${catchUp.label}: ${parts.join(', ')}`;
}

function startsIn(title: string, startsAt: string, at: number): string {
  const minutes = minutesUntil(Date.parse(startsAt), at);
  return minutes === 0 ? `${title} now` : `${title} in ${minutes} min`;
}

export function nudgeGroupOf(nudge: CalendarNudge): CalendarEvent[] {
  return nudge.kind === 'wrap_up' ? [] : nudge.group;
}

function groupText(nudge: CalendarNudge, size: number): string {
  return `${nudge.title} + ${size - 1} more at ${clock(Date.parse(nudge.startsAt))}`;
}

function withWaiting(line: string, waiting: number): string {
  if (waiting === 0) return line;
  return `${line} · ${countLabel(waiting, 'chat needs', 'chats need')} you`;
}

export function nudgeText(nudge: CalendarNudge, at: number, waiting: number): string {
  const size = nudgeGroupOf(nudge).length;
  if (size > 1) return withWaiting(groupText(nudge, size), nudge.kind === 'before' ? waiting : 0);
  if (nudge.kind === 'remind') return startsIn(nudge.title, nudge.startsAt, at);
  if (nudge.kind === 'before') {
    const line = startsIn(nudge.title, nudge.startsAt, at);
    if (waiting === 0) return line;
    return `${line} · ${countLabel(waiting, 'chat needs', 'chats need')} you`;
  }
  const line = startsIn('Meeting', nudge.startsAt, at);
  const chat = nudge.chats[0];
  if (!chat) return line;
  const state = chat.reason === 'running' ? 'is still running' : 'needs you';
  return `${line} · the ${chat.title} chat ${state}`;
}

function holdLine(now: CalendarNow, join: CalendarEvent | null): CalendarLine | null {
  const hold = now.hold;
  if (!hold) return null;
  const label = hold.focus ? 'Focus' : hold.title;
  return {
    kind: 'hold',
    key: `hold:${hold.eventKey}`,
    eventKey: hold.eventKey,
    text: `${label} · alerts held until ${clock(Date.parse(hold.until))}`,
    join,
    choose: null,
    capture: null,
    dismiss: null,
  };
}

function captureLine(now: CalendarNow, dismissed: ReadonlySet<string>): CalendarLine | null {
  const capture = now.capture;
  if (!capture || dismissed.has(capture.eventKey)) return null;
  return {
    kind: 'capture',
    key: `capture:${capture.eventKey}`,
    eventKey: capture.eventKey,
    text: `${capture.title} ended · anything to capture?`,
    join: null,
    choose: null,
    capture,
    dismiss: 'capture',
  };
}

function joinLine(now: CalendarNow, at: number): CalendarLine | null {
  const target = joinTarget(now.upcoming, at);
  if (!target?.link) return null;
  return {
    kind: 'join',
    key: `join:${target.key}`,
    eventKey: target.key,
    text: startsIn(target.title, target.start, at),
    join: target,
    choose: null,
    capture: null,
    dismiss: null,
  };
}

function meetingOf(now: CalendarNow, eventKey: string): CalendarEvent | null {
  return now.upcoming.find((event) => event.key === eventKey) ?? null;
}

export function hopKeys(now: CalendarNow | null): string[] {
  const nudge = now?.active ? now.nudge : null;
  if (!nudge || nudge.kind === 'wrap_up') return [];
  const members = nudge.group.map((event) => event.key).filter((key) => key !== nudge.eventKey);
  return [nudge.eventKey, ...members].map((key) => `${nudge.kind}:${key}`);
}

function catchUpLine(text: string): CalendarLine {
  return {
    kind: 'catch-up',
    key: 'catch-up',
    eventKey: null,
    text,
    join: null,
    choose: null,
    capture: null,
    dismiss: 'catch_up',
  };
}

function nudgeLine(now: CalendarNow, nudge: CalendarNudge, input: CalendarLineInput): CalendarLine {
  const group = nudgeGroupOf(nudge);
  const text = nudgeText(nudge, input.at, input.waiting);
  if (group.length > 1) {
    return {
      kind: 'nudge',
      key: `${nudge.kind}:${nudge.eventKey}:${group.length}`,
      eventKey: nudge.eventKey,
      text,
      join: null,
      choose: group,
      capture: null,
      dismiss: null,
    };
  }
  const nudged = meetingOf(now, nudge.eventKey);
  return {
    kind: 'nudge',
    key: `${nudge.kind}:${nudge.eventKey}`,
    eventKey: nudge.eventKey,
    text,
    join: nudged?.link ? nudged : joinTarget(now.upcoming, input.at),
    choose: null,
    capture: null,
    dismiss: null,
  };
}

export function calendarLine(input: CalendarLineInput): CalendarLine | null {
  const { now, at } = input;
  const caughtUp = input.catchUp ? catchUpText(input.catchUp) : null;
  if (!now?.active) return caughtUp ? catchUpLine(caughtUp) : null;
  if (now.nudge) return nudgeLine(now, now.nudge, input);
  const held = holdLine(now, joinTarget(now.upcoming, at));
  if (held) return held;
  if (caughtUp) return catchUpLine(caughtUp);
  const capture = captureLine(now, input.dismissed);
  if (capture) return capture;
  return joinLine(now, at);
}
