import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { keepListening } from '../src/persistence/notifications.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

it('listens again after its connection drops, and says when it is lost and back', async () => {
  const seen: string[] = [];
  const states: string[] = [];
  const listener = await keepListening(
    testDatabaseUrl(),
    'changes',
    (payload) => seen.push(payload),
    {
      onLost: () => states.push('lost'),
      onBack: () => states.push('back'),
    },
  );
  try {
    await t.db.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = current_database() AND query = 'LISTEN changes'`,
    );
    await eventually(async () => states.includes('back'));
    const marker = randomUUID();
    await t.db.query(`SELECT pg_notify('changes', $1)`, [marker]);
    await eventually(async () => seen.includes(marker));
    expect(states).toEqual(['lost', 'back']);
  } finally {
    await listener.close();
  }
});
