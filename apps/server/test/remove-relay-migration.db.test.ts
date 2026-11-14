import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { listTeammates } from '../src/persistence/teammates.ts';
import { migratedUpTo, oldConversation } from './migration-support.ts';

const REMOVE_RELAY_MIGRATION = '0245_remove_relay.sql';

describe('upgrading past the built-in follow-up Spark', () => {
  const state = migratedUpTo(REMOVE_RELAY_MIGRATION);

  it('deletes it, keeps its chats as ordinary chats and keeps the Sparks the user made', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    const builtIn = randomUUID();
    const own = randomUUID();
    await db.query(
      `INSERT INTO teammates (id, workspace_id, name, kind)
       VALUES ($1, $3, 'Courier', 'pr_follow_up'), ($2, $3, 'Pip', NULL)`,
      [builtIn, own, workspaceId],
    );
    const home = await oldConversation(db, workspaceId);
    const kept = await oldConversation(db, workspaceId);
    await db.query('UPDATE conversations SET teammate_id = $2 WHERE id = $1', [home.id, builtIn]);
    await db.query('UPDATE teammates SET home_conversation_id = $2 WHERE id = $1', [
      builtIn,
      home.id,
    ]);
    await db.query('UPDATE conversations SET teammate_id = $2 WHERE id = $1', [kept.id, own]);

    await runMigrations(db);

    const left = await listTeammates(db, workspaceId);
    expect(left.map((teammate) => teammate.name)).toEqual(['Pip']);
    const { rows } = await db.query<{ id: string; teammate_id: string | null }>(
      'SELECT id, teammate_id FROM conversations WHERE id = ANY($1::uuid[]) ORDER BY title, id',
      [[home.id, kept.id]],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === home.id)?.teammate_id).toBeNull();
    expect(rows.find((row) => row.id === kept.id)?.teammate_id).toBe(own);
  });
});
