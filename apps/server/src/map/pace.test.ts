import { describe, expect, it } from 'vitest';
import { createGate, MapStopped, type Clock } from './pace.ts';

function fakeClock() {
  let now = 0;
  const slept: number[] = [];
  const clock: Clock & { advance(ms: number): void; slept: number[] } = {
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
    advance(ms) {
      now += ms;
    },
    slept,
  };
  return clock;
}

describe('createGate', () => {
  it('sleeps long enough to keep work within the CPU budget', async () => {
    const clock = fakeClock();
    const gate = createGate({
      budget: 0.25,
      pollMs: 1_000,
      busy: async () => false,
      onPause: async () => undefined,
      signal: new AbortController().signal,
      clock,
    });
    clock.advance(100);
    await gate.yield();
    expect(clock.slept).toEqual([300]);
    clock.advance(10);
    await gate.yield();
    expect(clock.slept).toEqual([300]);
  });

  it('pauses while agent runs are active and reports pause and resume', async () => {
    const clock = fakeClock();
    const busy = [true, true, false];
    const pauses: boolean[] = [];
    const gate = createGate({
      budget: 1,
      pollMs: 5_000,
      busy: async () => busy.shift() ?? false,
      onPause: async (paused) => {
        pauses.push(paused);
      },
      signal: new AbortController().signal,
      clock,
    });
    await gate.step();
    expect(pauses).toEqual([true, false]);
    expect(clock.slept).toEqual([5_000, 5_000]);
  });

  it('stops promptly when the builder is stopped', async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    const gate = createGate({
      budget: 1,
      pollMs: 5_000,
      busy: async () => {
        controller.abort();
        return true;
      },
      onPause: async () => undefined,
      signal: controller.signal,
      clock,
    });
    await expect(gate.step()).rejects.toBeInstanceOf(MapStopped);
  });
});
