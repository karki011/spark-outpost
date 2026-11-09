import {
  joinableMeetings,
  spanOf,
  type CalendarEvent,
  type CalendarNow,
} from '@spark-outpost/contracts';
import { nudgeGroupOf } from './island-calendar.ts';

export type JoinChoice = { join: CalendarEvent } | { choose: CalendarEvent[] } | null;

function unique(events: readonly CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.key)) return false;
    seen.add(event.key);
    return true;
  });
}

export function joinChoice(now: CalendarNow | null, at: number, leadMs: number): JoinChoice {
  if (!now) return null;
  const group = now.nudge ? nudgeGroupOf(now.nudge) : [];
  const joinable = joinableMeetings([...now.upcoming, ...group], at, leadMs);
  const [only] = joinable;
  if (!only) return null;
  if (joinable.length === 1) return { join: only };
  const choose = unique([...joinable, ...group]).toSorted(
    (a, b) => spanOf(a).start - spanOf(b).start,
  );
  return { choose };
}
