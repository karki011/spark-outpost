import type { Queryable } from './db.ts';

export async function codeModeEnabled(db: Queryable, workspaceId: string): Promise<boolean> {
  if (process.env.SPARK_CODE_MODE === '0') return false;
  const { rows } = await db.query<{ code_mode: boolean }>(
    'SELECT code_mode FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.code_mode ?? true;
}
