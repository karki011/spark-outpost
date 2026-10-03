import { describe, expect, it } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import type { Clock } from './pace.ts';
import { LOW_CORE_COUNT, scanIndexPace, UNPACED_REFRESH_FILES } from './scan-index-pace.ts';

const noDb: Queryable = {
  query: () => Promise.reject(new Error('The pace must not read the database here.')),
} as unknown as Queryable;

function fakeClock() {
  let now = 0;
  const slept: number[] = [];
  const clock: Clock = {
    now: () => now,
    sleep: (ms) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
  return {
    clock,
    slept,
    work(ms: number) {
      now += ms;
    },
  };
}

const FULL_REBUILD = UNPACED_REFRESH_FILES * 6;

describe('pacing an index build started by a scan', () => {
  it('does not pace on a machine with more than four cores', () => {
    expect(scanIndexPace({ db: noDb, cores: LOW_CORE_COUNT + 1 })).toBeUndefined();
    expect(scanIndexPace({ db: noDb, cores: 16 })).toBeUndefined();
  });

  it('lets a small refresh through without waiting, even while agents run', async () => {
    const { clock, slept, work } = fakeClock();
    let asked = 0;
    const pace = scanIndexPace({
      db: noDb,
      cores: 4,
      clock,
      busy: () => {
        asked += 1;
        return Promise.resolve(true);
      },
    })!();
    work(500);
    await pace(0, UNPACED_REFRESH_FILES);
    expect(slept).toEqual([]);
    expect(asked).toBe(0);
  });

  it('keeps a full rebuild to thirty percent of the time on a low-core machine', async () => {
    const { clock, slept, work } = fakeClock();
    const pace = scanIndexPace({
      db: noDb,
      cores: 2,
      clock,
      busy: () => Promise.resolve(false),
    })!();
    work(300);
    await pace(0, FULL_REBUILD);
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeCloseTo(700, 5);
    work(600);
    await pace(UNPACED_REFRESH_FILES, FULL_REBUILD);
    expect(slept[1]).toBeCloseTo(1400, 5);
  });

  it('holds a full rebuild while agents run and goes on when they finish', async () => {
    const { clock, slept } = fakeClock();
    const busy = [true, true, true, false];
    const pace = scanIndexPace({
      db: noDb,
      cores: 4,
      clock,
      pollMs: 5_000,
      busy: () => Promise.resolve(busy.shift() ?? false),
    })!();
    await pace(0, FULL_REBUILD);
    expect(slept).toEqual([5_000, 5_000, 5_000]);
    expect(busy).toEqual([]);
  });
});
