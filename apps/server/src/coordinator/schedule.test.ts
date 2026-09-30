import { describe, expect, it } from 'vitest';
import { runReadySet, type Schedulable } from './schedule.ts';

interface Gate {
  open(): void;
  wait: Promise<void>;
}

function gate(): Gate {
  let open = () => undefined as void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait };
}

const piece = (key: string, dependsOn: string[] = []): Schedulable => ({ key, dependsOn });

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the ready-set scheduler', () => {
  it('runs independent pieces at once and starts a dependent when its piece lands', async () => {
    const gates = new Map(['P1', 'P2', 'P3'].map((key) => [key, gate()]));
    const events: string[] = [];
    const done = runReadySet([piece('P1'), piece('P2'), piece('P3', ['P1'])], {
      limit: 3,
      settled: new Set(),
      stopped: () => false,
      run: async (item, slot) => {
        events.push(`start ${item.key} in ${slot}`);
        await gates.get(item.key)!.wait;
        events.push(`end ${item.key}`);
        return true;
      },
    });
    await tick();
    expect(events).toEqual(['start P1 in 1', 'start P2 in 2']);
    gates.get('P1')!.open();
    await tick();
    expect(events).toEqual(['start P1 in 1', 'start P2 in 2', 'end P1', 'start P3 in 1']);
    gates.get('P2')!.open();
    gates.get('P3')!.open();
    expect(await done).toEqual({ landed: new Set(['P1', 'P2', 'P3']), failed: false });
  });

  it('never runs more pieces than its slots', async () => {
    let running = 0;
    let most = 0;
    await runReadySet([piece('A'), piece('B'), piece('C'), piece('D')], {
      limit: 2,
      settled: new Set(),
      stopped: () => false,
      run: async () => {
        running += 1;
        most = Math.max(most, running);
        await tick();
        running -= 1;
        return true;
      },
    });
    expect(most).toBe(2);
  });

  it('starts nothing new after a piece fails and waits for the running ones', async () => {
    const started: string[] = [];
    const result = await runReadySet([piece('P1'), piece('P2'), piece('P3', ['P2'])], {
      limit: 2,
      settled: new Set(),
      stopped: () => false,
      run: async (item) => {
        started.push(item.key);
        await tick();
        return item.key !== 'P1';
      },
    });
    expect(started).toEqual(['P1', 'P2']);
    expect(result).toEqual({ landed: new Set(['P2']), failed: true });
  });

  it('skips pieces that already landed and stops starting when told to', async () => {
    let stop = false;
    const started: string[] = [];
    await runReadySet([piece('P1'), piece('P2', ['P1']), piece('P3', ['P2'])], {
      limit: 1,
      settled: new Set(['P1']),
      stopped: () => stop,
      run: async (item) => {
        started.push(item.key);
        stop = true;
        return true;
      },
    });
    expect(started).toEqual(['P2']);
  });

  it('rethrows a piece error once the other running pieces settle', async () => {
    const finished: string[] = [];
    const run = runReadySet([piece('P1'), piece('P2')], {
      limit: 2,
      settled: new Set(),
      stopped: () => false,
      run: async (item) => {
        if (item.key === 'P1') throw new Error('lease lost');
        await tick();
        finished.push(item.key);
        return true;
      },
    });
    await expect(run).rejects.toThrow('lease lost');
    expect(finished).toEqual(['P2']);
  });
});
