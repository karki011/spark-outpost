import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startMorningBrief, type MorningBrief } from '../src/digest/morning.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const TICK_MS = 20;

let t: TestDb;
let brief: MorningBrief | null = null;
let refreshes = 0;

beforeEach(async () => {
  t = await createTestDb();
  refreshes = 0;
});

afterEach(async () => {
  brief?.stop();
  brief = null;
  await t.cleanup();
});

function start() {
  brief = startMorningBrief(
    t.db,
    t.workspaceId,
    async () => {
      refreshes += 1;
    },
    TICK_MS,
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, TICK_MS * 10));

describe('the morning brief job', () => {
  it('runs once a day after the time you saved', async () => {
    await updateProfile(t.db, t.workspaceId, { morningBriefTime: '00:00' });
    start();
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

  it('does nothing when you turn it off', async () => {
    await updateProfile(t.db, t.workspaceId, { morningBrief: false, morningBriefTime: '00:00' });
    start();
    await settle();
    expect(refreshes).toBe(0);
  });
});
