import { describe, expect, it } from 'vitest';
import { calendarConnection } from '../src/calendar/store.ts';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import type { Db } from '../src/persistence/db.ts';
import { migratedUpTo } from './migration-support.ts';

const ALERT_AT_START_MIGRATION = '0206_calendar_alert_at_start.sql';

async function leadAfterUpgrade(db: Db, stored: number | null): Promise<number> {
  const workspaceId = await ensureLocalWorkspace(db);
  if (stored === null) {
    await db.query('INSERT INTO calendar_connection (workspace_id, connected) VALUES ($1, true)', [
      workspaceId,
    ]);
  } else {
    await db.query(
      'INSERT INTO calendar_connection (workspace_id, connected, alert_lead) VALUES ($1, true, $2)',
      [workspaceId, stored],
    );
  }
  await runMigrations(db);
  return (await calendarConnection(db, workspaceId)).settings.alertLead;
}

describe('upgrading to the centre alert at the start of a meeting', () => {
  const state = migratedUpTo(ALERT_AT_START_MIGRATION);

  it('moves a connection on the old one-minute default to the start', async () => {
    expect(await leadAfterUpgrade(state.db, null)).toBe(0);
  });

  it('moves a stored one minute to the start', async () => {
    expect(await leadAfterUpgrade(state.db, 1)).toBe(0);
  });

  it('keeps five minutes', async () => {
    expect(await leadAfterUpgrade(state.db, 5)).toBe(5);
  });
});
