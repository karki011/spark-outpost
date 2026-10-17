import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedModelStats } from '../src/model-cards/ingest.ts';
import { getSetupState } from '../src/persistence/setup.ts';
import { stopActiveWork } from '../src/reset/stop-work.ts';
import { saveGoogleAccount } from '../src/calendar/google/store.ts';
import { googleCalendarSecret, memorySecretStore, type SecretId } from '../src/setup/secrets.ts';
import { postReset, recordingStore, rowCounts, seedAppData, seedRun } from './reset-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const REFILLED = ['workspaces', 'model_stats', 'schema_migrations'];

function storedSecrets(mcpId: string) {
  return recordingStore(
    memorySecretStore({
      claude: 'sk-ant-claude',
      codex: 'sk-codex',
      zai: 'zai-key',
      jev: 'jev-key',
      github: 'gho_token',
      'ticket:linear': 'lin_token',
      'ticket:jira': 'jira-token',
      [`mcp:${mcpId}` as SecretId]: '{"env":{"TOKEN":"x"}}',
    }),
  );
}

async function shippedModelStats(): Promise<number> {
  const fresh = await createTestDb();
  try {
    await seedModelStats(fresh.db);
    return (await rowCounts(fresh)).model_stats!;
  } finally {
    await fresh.cleanup();
  }
}

describe('POST /api/reset', () => {
  it('empties every app table and keeps the migration history', async () => {
    const { mcpId } = await seedAppData(t);
    const before = await rowCounts(t);
    const seeded = ['conversations', 'messages', 'runs', 'jobs', 'profiles', 'projects'];
    const mapTables = ['map_repos', 'map_areas', 'map_files', 'map_labels', 'map_overrides'];
    const caches = ['map_jev_calls', 'map_link_pairs', 'map_links', 'jev_answer_cache'];
    for (const table of [...seeded, ...mapTables, ...caches])
      expect(before[table], table).toBeGreaterThan(0);

    const response = await postReset(t, storedSecrets(mcpId), { keepApiKeys: false });

    expect(response.status).toBe(200);
    expect(response.body.problems).toEqual([]);
    const after = await rowCounts(t);
    const leftovers = Object.entries(after).filter(
      ([table, count]) => !REFILLED.includes(table) && count > 0,
    );
    expect(leftovers).toEqual([]);
    expect(after.schema_migrations).toBe(before.schema_migrations);
    expect(after.model_stats).toBe(await shippedModelStats());
    const { rows } = await t.db.query<{ id: string }>('SELECT id FROM workspaces');
    expect(rows).toEqual([{ id: t.workspaceId }]);
  });

  it('lands the app back on first-run onboarding', async () => {
    const { mcpId } = await seedAppData(t);
    await t.db.query('UPDATE profiles SET onboarding_completed_at = now()');
    expect((await getSetupState(t.db, t.workspaceId)).profile.onboardingCompleted).toBe(true);

    await postReset(t, storedSecrets(mcpId), { keepApiKeys: false });

    const state = await getSetupState(t.db, t.workspaceId);
    expect(state.profile).toMatchObject({ displayName: '', onboardingCompleted: false });
    expect(state.providers.every((provider) => provider.connection === null)).toBe(true);
  });

  it('removes every secret the app saved in the keychain', async () => {
    const { mcpId } = await seedAppData(t);
    const secrets = storedSecrets(mcpId);

    const response = await postReset(t, secrets, { keepApiKeys: false });

    expect(response.body.secretsRemoved).toBe(8);
    expect(secrets.deleted.sort()).toEqual(
      [
        'claude',
        'codex',
        'zai',
        'jev',
        'github',
        'ticket:linear',
        'ticket:jira',
        `mcp:${mcpId}`,
      ].sort(),
    );
    for (const id of secrets.deleted) expect(await secrets.get(id)).toBeNull();
  });

  it('removes Google Calendar sign-ins, found through their accounts', async () => {
    await saveGoogleAccount(t.db, t.workspaceId, { subject: '42', email: 'me@example.com' });
    const secrets = recordingStore(memorySecretStore());
    await secrets.set(googleCalendarSecret('42'), '1//refresh');

    await postReset(t, secrets, { keepApiKeys: true });

    expect(secrets.deleted).toEqual([googleCalendarSecret('42')]);
    expect(await secrets.get(googleCalendarSecret('42'))).toBeNull();
  });

  it('keeps provider API keys when asked and still removes the other tokens', async () => {
    const { mcpId } = await seedAppData(t);
    const secrets = storedSecrets(mcpId);

    const response = await postReset(t, secrets, { keepApiKeys: true });

    expect(response.status).toBe(200);
    expect(secrets.deleted.sort()).toEqual(
      ['github', 'ticket:linear', 'ticket:jira', `mcp:${mcpId}`].sort(),
    );
    expect(await secrets.get('claude')).toBe('sk-ant-claude');
    expect(await secrets.get('jev')).toBe('jev-key');
  });

  it('reports a keychain failure without undoing the wipe', async () => {
    const { mcpId } = await seedAppData(t);
    const secrets = storedSecrets(mcpId);
    secrets.delete = async (id) => {
      if (id === 'github') throw new Error('Keychain locked');
    };

    const response = await postReset(t, secrets, { keepApiKeys: true });

    expect(response.status).toBe(200);
    expect(response.body.problems).toEqual([
      "Couldn't remove the saved github secret from the keychain.",
    ]);
    expect((await rowCounts(t)).conversations).toBe(0);
  });

  it('rejects a request without the keep-keys choice', async () => {
    await seedAppData(t);
    const response = await postReset(t, memorySecretStore(), {});
    expect(response.status).toBe(400);
    expect((await rowCounts(t)).conversations).toBe(1);
  });
});

describe('stopping work before a reset', () => {
  it('asks active runs to stop, drops queued jobs and waits for leased ones', async () => {
    const queued = await seedRun(t);
    const leased = await seedRun(t);
    await t.db.query(
      `UPDATE jobs SET status = 'leased', lease_expires_at = now() + interval '1 minute'
       WHERE run_id = $1`,
      [leased],
    );
    setTimeout(() => {
      void t.db.query(`UPDATE jobs SET status = 'done' WHERE run_id = $1`, [leased]);
    }, 150);

    expect(await stopActiveWork(t.db, 5000)).toBe(0);

    const { rows } = await t.db.query<{ run_id: string; status: string; cancelled: boolean }>(
      `SELECT j.run_id, j.status, r.cancel_requested_at IS NOT NULL AS cancelled
       FROM jobs j JOIN runs r ON r.id = j.run_id ORDER BY j.run_id`,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { run_id: queued, status: 'failed', cancelled: true },
        { run_id: leased, status: 'done', cancelled: true },
      ]),
    );
  });

  it('gives up waiting after the settle time and reports the runs still stopping', async () => {
    const leased = await seedRun(t);
    await t.db.query(
      `UPDATE jobs SET status = 'leased', lease_expires_at = now() + interval '1 minute'
       WHERE run_id = $1`,
      [leased],
    );
    expect(await stopActiveWork(t.db, 150)).toBe(1);
  });
});
