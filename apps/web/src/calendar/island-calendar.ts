import type {
  CalendarCapture,
  CalendarEvent,
  CalendarNow,
  CalendarNudge,
  ConversationSummary,
} from '@spark-outpost/contracts';
import type { Chime } from '../island/island-sound.ts';
import { countLabel } from '../ui/count-label.ts';
import { clock, minutesUntil } from './calendar-format.ts';
import { stillOn } from './event-clock.ts';
import { nudgeHidden, type NudgeMarks } from './nudge-marks.ts';
import { meetingParts, type MeetingParts } from './meeting-line.ts';
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
  event: CalendarEvent | null;
  join: CalendarEvent | null;
  choose: CalendarEvent[] | null;
  capture: CalendarCapture | null;
  dismiss: 'catch_up' | 'capture' | null;
  meeting: MeetingParts | null;
}

export interface CalendarLineInput {
  now: CalendarNow | null;
  at: number;
  waiting: number;
  catchUp: CatchUp | null;
  dismissed: ReadonlySet<string>;
  marks: NudgeMarks;
  chats: ChatStates;
}

export type ChatStates = ReadonlyMap<string, 'running' | 'needs_you'>;

export function chatStates(chats: readonly ConversationSummary[]): ChatStates {
  const states = new Map<string, 'running' | 'needs_you'>();
  for (const chat of chats) {
    if (chat.archivedAt) continue;
    if (chat.needsInput) states.set(chat.id, 'needs_you');
    else if (chat.latestRun?.status === 'running' || chat.latestRun?.status === 'queued') {
      states.set(chat.id, 'running');
    }
  }
  return states;
}

export function liveWrapUp(nudge: CalendarNudge, states: ChatStates): CalendarNudge | null {
  if (nudge.kind !== 'wrap_up') return nudge;
  const chats = nudge.chats.flatMap((chat) => {
    const reason = states.get(chat.id);
    return reason ? [{ ...chat, reason }] : [];
  });
  return chats.length > 0 ? { ...nudge, chats } : null;
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
    event: null,
    join,
    choose: null,
    capture: null,
    dismiss: null,
    meeting: null,
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
    event: null,
    join: null,
    choose: null,
    capture,
    dismiss: 'capture',
    meeting: null,
  };
}

function shownJoin(now: CalendarNow, input: CalendarLineInput): CalendarEvent | null {
  const shown = stillOn(now.upcoming, input.at).filter(
    (event) => !nudgeHidden(input.marks, event.key, input.at),
  );
  return joinTarget(shown, input.at);
}

function joinLine(now: CalendarNow, input: CalendarLineInput): CalendarLine | null {
  const target = joinTarget(stillOn(now.upcoming, input.at), input.at);
  if (!target?.link || nudgeHidden(input.marks, target.key, input.at)) return null;
  return {
    kind: 'join',
    key: `join:${target.key}`,
    eventKey: target.key,
    text: startsIn(target.title, target.start, input.at),
    event: target,
    join: target,
    choose: null,
    capture: null,
    dismiss: null,
    meeting: meetingParts({
      title: target.title,
      startsAt: target.start,
      event: target,
      count: 1,
      chat: null,
      waiting: 0,
      at: input.at,
    }),
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
    event: null,
    join: null,
    choose: null,
    capture: null,
    dismiss: 'catch_up',
    meeting: null,
  };
}

function liveNudge(
  now: CalendarNow,
  nudge: CalendarNudge,
  input: CalendarLineInput,
): CalendarNudge | null {
  if (nudge.kind === 'wrap_up') return nudge;
  const fallback = meetingOf(now, nudge.eventKey);
  const members = nudge.group.length > 0 ? nudge.group : fallback ? [fallback] : [];
  if (members.length === 0) return nudge;
  const group = stillOn(members, input.at).filter(
    (event) => !nudgeHidden(input.marks, event.key, input.at),
  );
  if (group.length === 0) return null;
  const lead = group.find((event) => event.key === nudge.eventKey) ?? group[0]!;
  return { ...nudge, eventKey: lead.key, title: lead.title, startsAt: lead.start, group };
}

function nudgeLine(now: CalendarNow, shown: CalendarNudge, input: CalendarLineInput) {
  const current = liveWrapUp(shown, input.chats);
  const nudge = current ? liveNudge(now, current, input) : null;
  if (!nudge) return null;
  const group = nudgeGroupOf(nudge);
  const text = nudgeText(nudge, input.at, input.waiting);
  const nudged = meetingOf(now, nudge.eventKey);
  const meeting = meetingParts({
    title: nudge.title,
    startsAt: nudge.startsAt,
    event: nudged ?? group[0] ?? null,
    count: Math.max(1, group.length),
    chat: nudge.kind === 'wrap_up' ? (nudge.chats[0] ?? null) : null,
    waiting: nudge.kind === 'before' ? input.waiting : 0,
    at: input.at,
  });
  if (group.length > 1) {
    return {
      kind: 'nudge' as const,
      key: `${nudge.kind}:${nudge.eventKey}:${group.length}`,
      eventKey: nudge.eventKey,
      text,
      event: null,
      join: null,
      choose: group,
      capture: null,
      dismiss: null,
      meeting,
    };
  }
  if (nudgeHidden(input.marks, nudge.eventKey, input.at)) return null;
  return {
    kind: 'nudge' as const,
    key: `${nudge.kind}:${nudge.eventKey}`,
    eventKey: nudge.eventKey,
    text,
    event: nudge.kind === 'wrap_up' ? null : nudged,
    join: nudged?.link ? nudged : shownJoin(now, input),
    choose: null,
    capture: null,
    dismiss: null,
    meeting,
  };
}

export function calendarLine(input: CalendarLineInput): CalendarLine | null {
  const { now } = input;
  const caughtUp = input.catchUp ? catchUpText(input.catchUp) : null;
  if (!now?.active) return caughtUp ? catchUpLine(caughtUp) : null;
  const nudged = now.nudge ? nudgeLine(now, now.nudge, input) : null;
  if (nudged) return nudged;
  const held = holdLine(now, shownJoin(now, input));
  if (held) return held;
  if (caughtUp) return catchUpLine(caughtUp);
  const capture = captureLine(now, input.dismissed);
  if (capture) return capture;
  return joinLine(now, input);
}
