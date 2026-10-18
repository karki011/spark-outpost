import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { migratedUpTo } from './migration-support.ts';

const NUDGES_MIGRATION = '0185_calendar_nudges.sql';

async function oldChoice(db: Db, workspaceId: string, title: string, nudges: boolean) {
  await db.query(
    `INSERT INTO calendar_calendars (key, workspace_id, calendar_id, title, source_id,
       source_title, source_kind, color, writable, subscribed, ownership, include, nudges, busy)
     VALUES ($1, $2, $3, $3, 'src', 'On My Mac', 'local', '#336699', true, false, 'mine',
       true, $4, false)`,
    [randomUUID(), workspaceId, title, nudges],
  );
}

describe('upgrading to nudges on and no busy switch', () => {
  const state = migratedUpTo(NUDGES_MIGRATION);

  it('turns nudges on for every saved calendar and drops the busy column', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    await oldChoice(db, workspaceId, 'Work', false);
    await oldChoice(db, workspaceId, 'Family', true);
    await runMigrations(db);

    const { rows } = await db.query<{ title: string; nudges: boolean }>(
      'SELECT title, nudges FROM calendar_calendars ORDER BY title',
    );
    expect(rows).toEqual([
      { title: 'Family', nudges: true },
      { title: 'Work', nudges: true },
    ]);
    const columns = await db.query<{ column_name: string; column_default: string | null }>(
      `SELECT column_name, column_default FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'calendar_calendars'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain('busy');
    expect(columns.rows.find((row) => row.column_name === 'nudges')?.column_default).toBe('true');
  });
});
