import { addLocalDays, localDayStart, type HelperEvent } from '@spark-outpost/contracts';
import type { CalendarHelper } from './helper-process.ts';

export const WINDOW_REFRESH_MS = 15 * 60_000;
export const WINDOW_DAYS_BEFORE = 1;
export const WINDOW_DAYS_AFTER = 8;

export interface WindowSnapshot {
  events: HelperEvent[];
  truncated: boolean;
  from: string;
  to: string;
}

export interface Timers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EventWindowOptions {
  helper: Pick<CalendarHelper, 'call'>;
  now: () => number;
  changed: () => void;
  timers?: Timers;
}

export interface EventWindow {
  read(): Promise<WindowSnapshot>;
  invalidate(): void;
  stop(): void;
}

const realTimers: Timers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export function windowRange(now: number): { from: string; to: string } {
  const today = localDayStart(now);
  return {
    from: new Date(addLocalDays(today, -WINDOW_DAYS_BEFORE)).toISOString(),
    to: new Date(addLocalDays(today, WINDOW_DAYS_AFTER)).toISOString(),
  };
}

export function nextRefreshMs(now: number): number {
  const midnight = addLocalDays(localDayStart(now), 1) - now;
  return Math.max(1_000, Math.min(WINDOW_REFRESH_MS, midnight + 1_000));
}

export function createEventWindow(options: EventWindowOptions): EventWindow {
  const timers = options.timers ?? realTimers;
  let cached: Promise<WindowSnapshot> | null = null;
  let timer: unknown = null;
  let generation = 0;

  const schedule = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      invalidate();
    }, nextRefreshMs(options.now()));
  };

  const load = async (): Promise<WindowSnapshot> => {
    const range = windowRange(options.now());
    const answer = await options.helper.call({ op: 'events', ...range });
    return { events: answer.events, truncated: answer.truncated, ...range };
  };

  function invalidate(): void {
    if (cached === null && timer === null) return;
    generation += 1;
    cached = null;
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    options.changed();
  }

  return {
    read() {
      if (cached) return cached;
      const mine = generation;
      const loading = load();
      cached = loading;
      loading.then(
        () => {
          if (mine === generation) schedule();
        },
        () => {
          if (cached === loading) cached = null;
        },
      );
      return loading;
    },
    invalidate,
    stop() {
      generation += 1;
      cached = null;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}
