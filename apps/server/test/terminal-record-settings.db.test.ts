import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { profileSchema } from '@spark-outpost/contracts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { getSetupState, updateProfile } from '../src/persistence/setup.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.cleanup();
});

it('starts new profiles with Terminal recording on and retains a saved off choice', async () => {
  const { profile } = await getSetupState(t.db, t.workspaceId);
  expect(profile.terminalRecordLikeChat).toBe(true);
  expect(
    profileSchema.parse({ ...profile, terminalRecordLikeChat: undefined }).terminalRecordLikeChat,
  ).toBe(true);
  await updateProfile(t.db, t.workspaceId, { terminalRecordLikeChat: false });
  await updateProfile(t.db, t.workspaceId, { displayName: 'Saved choice' });
  expect((await getSetupState(t.db, t.workspaceId)).profile.terminalRecordLikeChat).toBe(false);
  await updateProfile(t.db, t.workspaceId, { terminalRecordLikeChat: true });
  expect((await getSetupState(t.db, t.workspaceId)).profile.terminalRecordLikeChat).toBe(true);
});

it('changes only the default during upgrade, preserving existing on and off profiles', async () => {
  await t.db.query('ALTER TABLE profiles ALTER COLUMN terminal_record_like_chat SET DEFAULT false');
  await t.db.query('DELETE FROM schema_migrations WHERE name = $1', [
    '0218_terminal_record_default.sql',
  ]);
  const off = t.workspaceId;
  const on = randomUUID();
  const fresh = randomUUID();
  await t.db.query(
    "INSERT INTO workspaces (id, slug, name) VALUES ($1, 'existing-on', 'Existing on'), ($2, 'fresh', 'Fresh')",
    [on, fresh],
  );
  await t.db.query('INSERT INTO profiles (workspace_id) VALUES ($1)', [off]);
  await t.db.query(
    'INSERT INTO profiles (workspace_id, terminal_record_like_chat) VALUES ($1, true)',
    [on],
  );
  expect(await runMigrations(t.db)).toEqual(['0218_terminal_record_default.sql']);
  expect((await getSetupState(t.db, off)).profile.terminalRecordLikeChat).toBe(false);
  expect((await getSetupState(t.db, on)).profile.terminalRecordLikeChat).toBe(true);
  expect((await getSetupState(t.db, fresh)).profile.terminalRecordLikeChat).toBe(true);
  expect(await runMigrations(t.db)).toEqual([]);
  expect((await getSetupState(t.db, off)).profile.terminalRecordLikeChat).toBe(false);
});
