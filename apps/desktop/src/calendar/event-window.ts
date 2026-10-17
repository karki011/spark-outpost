import {
  addLocalDays,
  eventsInSpan,
  localDayStart,
  type HelperEvent,
} from '@spark-outpost/contracts';
import type { CalendarHelper } from './helper-process.ts';

export const WINDOW_REFRESH_MS = 15 * 60_000;
export const WINDOW_DAYS_BEFORE = 1;
export const WINDOW_DAYS_AFTER = 8;
export const RANGE_KEEP_MS = 3 * 60_000;
export const RANGE_CACHE_MAX = 6;

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

export interface RangeEvents {
  events: HelperEvent[];
  truncated: boolean;
}

export interface EventWindow {
  read(): Promise<WindowSnapshot>;
  range(from: string, to: string): Promise<RangeEvents>;
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
  const ranges = new Map<string, { at: number; loading: Promise<RangeEvents> }>();

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
    ranges.clear();
    if (cached === null && timer === null) return;
    generation += 1;
    cached = null;
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    options.changed();
  }

  function read(): Promise<WindowSnapshot> {
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
  }

  function readUncovered(from: string, to: string): Promise<RangeEvents> {
    const key = `${from}|${to}`;
    const known = ranges.get(key);
    if (known && options.now() - known.at < RANGE_KEEP_MS) return known.loading;
    const loading = options.helper
      .call({ op: 'events', from, to })
      .then((answer) => ({ events: answer.events, truncated: answer.truncated }));
    loading.catch(() => {
      if (ranges.get(key)?.loading === loading) ranges.delete(key);
    });
    ranges.delete(key);
    ranges.set(key, { at: options.now(), loading });
    while (ranges.size > RANGE_CACHE_MAX) ranges.delete(ranges.keys().next().value!);
    return loading;
  }

  return {
    read,
    async range(from, to) {
      const start = Date.parse(from);
      const end = Date.parse(to);
      const stored = await read();
      if (Date.parse(stored.from) <= start && end <= Date.parse(stored.to)) {
        return { events: eventsInSpan(stored.events, start, end), truncated: stored.truncated };
      }
      return readUncovered(from, to);
    },
    invalidate,
    stop() {
      ranges.clear();
      generation += 1;
      cached = null;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}
