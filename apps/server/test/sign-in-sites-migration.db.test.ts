import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { listSignInRows } from '../src/persistence/browser-sign-ins.ts';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { migratedUpTo } from './migration-support.ts';

describe('upgrading saved sign-ins to several sites', () => {
  const state = migratedUpTo('0189_browser_sign_in_sites.sql');

  it('keeps every saved sign-in working on its one site', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    const projectId = randomUUID();
    await db.query(
      `INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, 'site', '/tmp/site')`,
      [projectId, workspaceId],
    );
    const id = randomUUID();
    await db.query(
      `INSERT INTO browser_sign_ins (id, project_id, label, origin, keychain_ref)
       VALUES ($1, $2, 'Staging admin', 'https://staging.example.com', $3)`,
      [id, projectId, `signin:${id}`],
    );
    await runMigrations(db);

    const [row] = await listSignInRows(db, projectId);
    expect(row).toMatchObject({
      id,
      origin: 'https://staging.example.com',
      sites: [],
      refused_site: null,
      keychain_ref: `signin:${id}`,
    });
    await expect(
      db.query('UPDATE browser_sign_ins SET sites = $1 WHERE id = $2', [
        Array.from({ length: 9 }, (_, index) => `https://s${index}.example.com`),
        id,
      ]),
    ).rejects.toThrow();
  });
});
