import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, Supervisor, type Backoff, type Supervised } from './supervisor.ts';

const backoff: Backoff = { initialMs: 100, maxMs: 1_000, stableMs: 10_000, maxFailures: 3 };

function fakeProcess() {
  let exit: (code: number | null) => void = () => undefined;
  const exited = new Promise<number | null>((resolve) => {
    exit = resolve;
  });
  const stop = vi.fn(async () => exit(0));
  const process: Supervised = { exited, stop };
  return { process, exit, stop };
}

function harness() {
  let clock = 0;
  const processes: ReturnType<typeof fakeProcess>[] = [];
  const sleeps: number[] = [];
  const restarts: number[] = [];
  const gaveUp = vi.fn();
  const supervisor = new Supervisor({
    backoff,
    now: () => clock,
    start: () => {
      const next = fakeProcess();
      processes.push(next);
      return next.process;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    onRestart: (ms) => restarts.push(ms),
    onGiveUp: gaveUp,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { supervisor, processes, sleeps, restarts, gaveUp, advance, settle };
}

describe('backoffDelay', () => {
  it('doubles from the initial delay up to the cap', () => {
    expect([1, 2, 3, 4, 5].map((failures) => backoffDelay(failures, backoff))).toEqual([
      100, 200, 400, 800, 1_000,
    ]);
  });
});

describe('Supervisor', () => {
  it('restarts a crashed process with growing delays', async () => {
    const h = harness();
    h.supervisor.start();
    h.processes[0]!.exit(1);
    await h.settle();
    h.processes[1]!.exit(1);
    await h.settle();
    expect(h.processes).toHaveLength(3);
    expect(h.restarts).toEqual([100, 200]);
    await h.supervisor.stop();
  });

  it('resets the delay after a process ran long enough to count as stable', async () => {
    const h = harness();
    h.supervisor.start();
    h.processes[0]!.exit(1);
    await h.settle();
    h.advance(backoff.stableMs);
    h.processes[1]!.exit(1);
    await h.settle();
    expect(h.restarts).toEqual([100, 100]);
    await h.supervisor.stop();
  });

  it('gives up after repeated quick crashes', async () => {
    const h = harness();
    h.supervisor.start();
    for (let index = 0; index <= backoff.maxFailures; index += 1) {
      h.processes[index]!.exit(1);
      await h.settle();
    }
    expect(h.gaveUp).toHaveBeenCalledWith(1);
    expect(h.processes).toHaveLength(backoff.maxFailures + 1);
  });

  it('stops the running process and does not restart it', async () => {
    const h = harness();
    h.supervisor.start();
    await h.supervisor.stop();
    expect(h.processes[0]!.stop).toHaveBeenCalledOnce();
    await h.settle();
    expect(h.processes).toHaveLength(1);
    expect(h.restarts).toEqual([]);
  });
});
