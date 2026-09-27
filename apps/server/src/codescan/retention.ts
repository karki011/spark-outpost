import type { Queryable } from '../persistence/db.ts';

export const GLOBAL_CAP_BYTES = 500 * 1024 * 1024;
export const EXPIRY_DAYS = 30;

export async function expireIndexes(db: Queryable, days: number = EXPIRY_DAYS): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM code_index_projects WHERE last_opened_at < now() - make_interval(days => $1)`,
    [days],
  );
  return rowCount ?? 0;
}

export async function evictBeyondCap(
  db: Queryable,
  keepProjectId: string,
  capBytes: number = GLOBAL_CAP_BYTES,
): Promise<string[]> {
  const { rows } = await db.query<{ root_path: string }>(
    `WITH ranked AS (
       SELECT id, root_path,
         sum(bytes) OVER (ORDER BY (id = $1) DESC, last_opened_at DESC, id) AS running
       FROM code_index_projects
     )
     DELETE FROM code_index_projects p USING ranked r
     WHERE p.id = r.id AND r.id <> $1 AND r.running > $2
     RETURNING r.root_path`,
    [keepProjectId, capBytes],
  );
  return rows.map((row) => row.root_path);
}

export async function deleteIndexForRoot(db: Queryable, root: string): Promise<void> {
  await db.query('DELETE FROM code_index_projects WHERE root_path = $1', [root]);
}
