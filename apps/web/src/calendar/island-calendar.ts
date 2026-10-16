import type {
  CalendarCapture,
  CalendarNow,
  CalendarNudge,
  JoinLink,
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

export interface CalendarLine {
  key: string;
  text: string;
  join: JoinLink | null;
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

export function nudgeText(nudge: CalendarNudge, at: number, waiting: number): string {
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

function holdLine(now: CalendarNow, join: JoinLink | null): CalendarLine | null {
  const hold = now.hold;
  if (!hold) return null;
  const label = hold.focus ? 'Focus' : hold.title;
  return {
    key: `hold:${hold.eventKey}`,
    text: `${label} · alerts held until ${clock(Date.parse(hold.until))}`,
    join,
    capture: null,
    dismiss: null,
  };
}

function captureLine(now: CalendarNow, dismissed: ReadonlySet<string>): CalendarLine | null {
  const capture = now.capture;
  if (!capture || dismissed.has(capture.eventKey)) return null;
  return {
    key: `capture:${capture.eventKey}`,
    text: `${capture.title} ended · anything to capture?`,
    join: null,
    capture,
    dismiss: 'capture',
  };
}

function joinLine(now: CalendarNow, at: number): CalendarLine | null {
  const target = joinTarget(now.upcoming, at);
  if (!target?.link) return null;
  return {
    key: `join:${target.key}`,
    text: startsIn(target.title, target.start, at),
    join: target.link,
    capture: null,
    dismiss: null,
  };
}

export function calendarLine(input: CalendarLineInput): CalendarLine | null {
  const { now, at } = input;
  const caughtUp = input.catchUp ? catchUpText(input.catchUp) : null;
  if (!now?.active) {
    return caughtUp
      ? { key: 'catch-up', text: caughtUp, join: null, capture: null, dismiss: 'catch_up' }
      : null;
  }
  const join = joinTarget(now.upcoming, at)?.link ?? null;
  const held = holdLine(now, join);
  if (held) return held;
  if (caughtUp) {
    return { key: 'catch-up', text: caughtUp, join: null, capture: null, dismiss: 'catch_up' };
  }
  const capture = captureLine(now, input.dismissed);
  if (capture) return capture;
  if (now.nudge) {
    return {
      key: `${now.nudge.kind}:${now.nudge.eventKey}`,
      text: nudgeText(now.nudge, at, input.waiting),
      join,
      capture: null,
      dismiss: null,
    };
  }
  return joinLine(now, at);
}
