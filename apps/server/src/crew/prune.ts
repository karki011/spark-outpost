import { readdir } from 'node:fs/promises';
import type { Queryable } from '../persistence/db.ts';
import { removeSparkFolder } from './spark-folder.ts';

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export async function pruneSparkFolders(db: Queryable, sparksDir: string): Promise<number> {
  const entries = await readdir(sparksDir, { withFileTypes: true }).catch(() => []);
  const ids = entries
    .filter((entry) => entry.isDirectory() && UUID.test(entry.name))
    .map((entry) => entry.name);
  if (ids.length === 0) return 0;
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM teammates WHERE id = ANY($1::uuid[])',
    [ids],
  );
  const kept = new Set(rows.map((row) => row.id));
  const gone = ids.filter((id) => !kept.has(id));
  for (const id of gone) await removeSparkFolder(sparksDir, id);
  return gone.length;
}
