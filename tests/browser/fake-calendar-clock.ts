import { readFileSync, writeFileSync } from 'node:fs';

const DAY_OPENS_HOUR = 6;
const DAY_CLOSES_HOUR = 16;
const PINNED_HOUR = 10;

export function calendarClockFile(stateFile: string): string {
  return `${stateFile}.clock.json`;
}

export function calendarClockOffset(real: number): number {
  const hour = new Date(real).getHours();
  if (hour >= DAY_OPENS_HOUR && hour < DAY_CLOSES_HOUR) return 0;
  const pinned = new Date(real);
  pinned.setHours(PINNED_HOUR, 0, 0, 0);
  return pinned.getTime() - real;
}

export function saveCalendarClock(stateFile: string, offsetMs: number): void {
  writeFileSync(calendarClockFile(stateFile), JSON.stringify({ offsetMs }));
}

export function readCalendarClock(stateFile: string): number {
  try {
    const saved = JSON.parse(readFileSync(calendarClockFile(stateFile), 'utf8')) as {
      offsetMs?: unknown;
    };
    return typeof saved.offsetMs === 'number' ? saved.offsetMs : 0;
  } catch {
    return 0;
  }
}

export function shiftProcessClock(offsetMs: number): void {
  if (offsetMs === 0) return;
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offsetMs);
      else super(...(args as [string | number | Date]));
    }

    static override now(): number {
      return RealDate.now() + offsetMs;
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
}
