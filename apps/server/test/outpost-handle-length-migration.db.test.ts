import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { migratedUpTo, oldConversation } from './migration-support.ts';

const HANDLE_LENGTH_MIGRATION = '0164_outpost_handle_length.sql';
const SIXTEEN = 'customer-orders1';
const SEVENTEEN = 'customer-orders12';
const THIRTY_TWO = 'customer-orders-service-frontend';
const THIRTY_THREE = 'customer-orders-service-frontends';

async function outpost(db: Db, workspaceId: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO outposts (id, workspace_id, name) VALUES ($1, $2, 'Orders launch')`, [
    id,
    workspaceId,
  ]);
  return id;
}

async function join(db: Db, workspaceId: string, outpostId: string, handle: string) {
  const chat = await oldConversation(db, workspaceId);
  await db.query(
    `INSERT INTO outpost_members (outpost_id, conversation_id, handle, position)
     VALUES ($1, $2, $3, 1)`,
    [outpostId, chat.id, handle],
  );
}

async function handles(db: Db, outpostId: string): Promise<string[]> {
  const { rows } = await db.query<{ handle: string }>(
    'SELECT handle FROM outpost_members WHERE outpost_id = $1 ORDER BY handle',
    [outpostId],
  );
  return rows.map((row) => row.handle);
}

describe('upgrading to handles of up to 32 characters', () => {
  const state = migratedUpTo(HANDLE_LENGTH_MIGRATION);

  it('keeps existing handles and accepts a longer one', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    const outpostId = await outpost(db, workspaceId);
    await join(db, workspaceId, outpostId, 'fe');
    await join(db, workspaceId, outpostId, SIXTEEN);
    await expect(join(db, workspaceId, outpostId, SEVENTEEN)).rejects.toThrow(/handle_check/);

    await runMigrations(db);

    expect(await handles(db, outpostId)).toEqual([SIXTEEN, 'fe']);
    await join(db, workspaceId, outpostId, SEVENTEEN);
    await join(db, workspaceId, outpostId, THIRTY_TWO);
    expect(await handles(db, outpostId)).toEqual([THIRTY_TWO, SIXTEEN, SEVENTEEN, 'fe']);
  });

  it('still refuses a handle that is too long, too short, reserved or badly formed', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    await runMigrations(db);
    const outpostId = await outpost(db, workspaceId);

    for (const handle of [THIRTY_THREE, 'a', 'all', 'Docs', '2nd', 'fe_1']) {
      await expect(join(db, workspaceId, outpostId, handle), handle).rejects.toThrow(
        /handle_check/,
      );
    }
  });

  it('keeps one handle per outpost', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    await runMigrations(db);
    const outpostId = await outpost(db, workspaceId);
    await join(db, workspaceId, outpostId, THIRTY_TWO);

    await expect(join(db, workspaceId, outpostId, THIRTY_TWO)).rejects.toThrow(
      /outpost_members_handle/,
    );
  });
});
