import { describe, expect, it } from 'vitest';
import { calendarConnection, updateSettings } from '../src/calendar/store.ts';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { migratedUpTo } from './migration-support.ts';

const AGENTS_READ_MIGRATION = '0202_calendar_agents_read_default.sql';

describe('upgrading to Let agents read my calendar on by default', () => {
  const state = migratedUpTo(AGENTS_READ_MIGRATION);

  it('turns reading on for an existing connection that had it off, and keeps a later off', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(
      'INSERT INTO calendar_connection (workspace_id, connected, agents_read) VALUES ($1, true, false)',
      [workspaceId],
    );
    await runMigrations(db);

    const { rows } = await db.query<{ agents_read: boolean | null }>(
      'SELECT agents_read FROM calendar_connection WHERE workspace_id = $1',
      [workspaceId],
    );
    expect(rows[0]?.agents_read).toBeNull();
    expect((await calendarConnection(db, workspaceId)).settings.agentsRead).toBe(true);

    await updateSettings(db, workspaceId, { agentsRead: false });
    expect((await calendarConnection(db, workspaceId)).settings.agentsRead).toBe(false);
  });
});
