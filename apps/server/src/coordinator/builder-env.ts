import { builderEnvSchema } from '../approvals/piece-guard.ts';
import type { Db, Queryable } from '../persistence/db.ts';

export interface ProjectSettings {
  builderEnv: Record<string, string> | null;
  stableCheckout: boolean;
}

export async function projectSettings(db: Queryable, runId: string): Promise<ProjectSettings> {
  const { rows } = await db.query<{ builder_env: unknown; stable_checkout: boolean }>(
    `SELECT p.builder_env, p.stable_checkout FROM runs r
     JOIN conversation_projects cp ON cp.conversation_id = r.conversation_id
     JOIN projects p ON p.id = cp.project_id
     WHERE r.id = $1
     ORDER BY cp.position, cp.created_at
     LIMIT 1`,
    [runId],
  );
  const row = rows[0];
  return {
    builderEnv: builderEnvSchema
      .nullable()
      .catch(null)
      .parse(row?.builder_env ?? null),
    stableCheckout: row?.stable_checkout ?? false,
  };
}

export function builderEnvFor(
  template: Record<string, string> | null,
  slot: number,
  name: string,
): Record<string, string> {
  const filled = Object.entries(template ?? {}).map(([key, value]) => [
    key,
    value.replaceAll('{slot}', String(slot)),
  ]);
  return {
    ...Object.fromEntries(filled),
    SPARK_BUILDER_SLOT: String(slot),
    SPARK_BUILDER_NAME: name,
  };
}

export async function withCheckLock<T>(db: Db, root: string, work: () => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`spark-checks:${root}`]);
    try {
      return await work();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`spark-checks:${root}`]);
    }
  } finally {
    client.release();
  }
}
