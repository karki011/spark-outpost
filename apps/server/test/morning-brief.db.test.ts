import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startMorningBrief, type MorningBrief } from '../src/digest/morning.ts';
import type { Db } from '../src/persistence/db.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { setSparkPaused } from '../src/persistence/spark-pause.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const TICK_MS = 20;

let t: TestDb;
let briefs: MorningBrief[] = [];
let refreshes = 0;

beforeEach(async () => {
  t = await createTestDb();
  refreshes = 0;
});

afterEach(async () => {
  for (const brief of briefs) brief.stop();
  briefs = [];
  await t.cleanup();
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function start(db: Db = t.db, refreshMs = 0, tickMs = TICK_MS) {
  const brief = startMorningBrief(
    db,
    t.workspaceId,
    async () => {
      refreshes += 1;
      await pause(refreshMs);
    },
    tickMs,
  );
  briefs.push(brief);
}

function slowDb(db: Db, delayMs: number): Db {
  return new Proxy(db, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (key === 'query') {
        return async (...args: unknown[]) => {
          await pause(delayMs);
          return (target.query as (...rest: unknown[]) => Promise<unknown>)(...args);
        };
      }
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  });
}

const settle = () => pause(TICK_MS * 10);

describe('the morning brief job', () => {
  it('runs once a day after the time you saved', async () => {
    await updateProfile(t.db, t.workspaceId, { morningBriefTime: '00:00' });
    start();
    await eventually(async () => refreshes > 0 || null);
    await settle();
    expect(refreshes).toBe(1);
  });

  it('runs once when ticks overlap on a slow database', async () => {
    await updateProfile(t.db, t.workspaceId, { morningBriefTime: '00:00' });
    const slow = slowDb(t.db, 40);
    start(slow, 150, 5);
    await eventually(async () => refreshes > 0 || null);
    await settle();
    expect(refreshes).toBe(1);
  });

  it('runs once when several workers tick at the same time', async () => {
    await updateProfile(t.db, t.workspaceId, { morningBriefTime: '00:00' });
    const slow = slowDb(t.db, 40);
    for (let worker = 0; worker < 4; worker += 1) start(slow, 150, 5);
    await eventually(async () => refreshes > 0 || null);
    await settle();
    expect(refreshes).toBe(1);
  });

  it('waits until the saved time', async () => {
    const hour = new Date().getHours();
    if (hour === 23) return;
    const later = `${String(hour + 1).padStart(2, '0')}:00`;
    await updateProfile(t.db, t.workspaceId, { morningBriefTime: later });
    start();
    await settle();
    expect(refreshes).toBe(0);
  });

  it('waits while Spark is paused and runs the same day once it is resumed', async () => {
    await updateProfile(t.db, t.workspaceId, { morningBriefTime: '00:00' });
    await setSparkPaused(t.db, t.workspaceId, true);
    start();
    await settle();
    expect(refreshes).toBe(0);

    await setSparkPaused(t.db, t.workspaceId, false);
    await eventually(async () => refreshes > 0 || null);
    expect(refreshes).toBe(1);
  });

  it('does nothing when you turn it off', async () => {
    await updateProfile(t.db, t.workspaceId, { morningBrief: false, morningBriefTime: '00:00' });
    start();
    await settle();
    expect(refreshes).toBe(0);
  });
});
