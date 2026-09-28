import { seedModelStats } from '../model-cards/ingest.ts';
import type { Db, Queryable } from '../persistence/db.ts';
import { truncateTables } from '../persistence/truncate.ts';

const KEPT_TABLE = 'schema_migrations';

export async function appTables(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> $1
     ORDER BY table_name`,
    [KEPT_TABLE],
  );
  return rows.map((row) => row.table_name);
}

export async function wipeAppData(db: Db, workspaceId: string): Promise<void> {
  const { rows } = await db.query<{ slug: string; name: string }>(
    'SELECT slug, name FROM workspaces WHERE id = $1',
    [workspaceId],
  );
  const workspace = rows[0];
  if (!workspace) throw new Error('The local workspace is missing.');
  await truncateTables(db, await appTables(db), {
    refill: async (client) => {
      await client.query('INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, $3)', [
        workspaceId,
        workspace.slug,
        workspace.name,
      ]);
      await seedModelStats(client);
    },
  });
}
