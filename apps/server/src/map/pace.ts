import { setImmediate as nextTurn } from 'node:timers/promises';

export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface GateOptions {
  budget: number;
  busyCheckMs?: number;
  pollMs: number;
  busy: () => Promise<boolean>;
  onPause: (paused: boolean) => Promise<void>;
  signal: AbortSignal;
  clock: Clock;
}

export interface Gate {
  yield(): Promise<void>;
  step(): Promise<void>;
}

const SLICE_MS = 40;
const BUSY_CHECK_MS = 1_000;

export const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(done, ms);
      function done() {
        signal.removeEventListener('abort', done);
        clearTimeout(timer);
        resolve();
      }
      signal.addEventListener('abort', done, { once: true });
    }),
};

export class MapStopped extends Error {
  constructor() {
    super('The map builder stopped.');
  }
}

export function createGate(options: GateOptions): Gate {
  const { clock, signal } = options;
  const busyCheckMs = options.busyCheckMs ?? BUSY_CHECK_MS;
  let resumedAt = clock.now();
  let checkedAt = -Infinity;

  async function yieldTurn(): Promise<void> {
    if (signal.aborted) throw new MapStopped();
    const busyFor = clock.now() - resumedAt;
    if (busyFor >= SLICE_MS) {
      await clock.sleep((busyFor * (1 - options.budget)) / options.budget, signal);
      resumedAt = clock.now();
    } else {
      await nextTurn();
    }
    if (signal.aborted) throw new MapStopped();
  }

  async function waitWhileBusy(): Promise<void> {
    if (clock.now() - checkedAt < busyCheckMs) return;
    checkedAt = clock.now();
    if (!(await options.busy())) return;
    await options.onPause(true);
    do {
      await clock.sleep(options.pollMs, signal);
      if (signal.aborted) throw new MapStopped();
    } while (await options.busy());
    await options.onPause(false);
    checkedAt = clock.now();
    resumedAt = clock.now();
  }

  return {
    yield: yieldTurn,
    async step() {
      await yieldTurn();
      await waitWhileBusy();
    },
  };
}
