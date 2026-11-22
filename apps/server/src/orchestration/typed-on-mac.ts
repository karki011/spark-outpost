import type { SparkOrigin } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

const TYPED_SOURCES: ReadonlySet<string | null> = new Set([null, 'ui', 'e2e', 'bench', 'queue']);

export async function typedOnTheMac(
  db: Queryable,
  runId: string,
): Promise<'yes' | 'device' | 'no'> {
  const { rows } = await db.query<{ source: string | null; device: string | null }>(
    'SELECT source, remote_device_id AS device FROM runs WHERE id = $1',
    [runId],
  );
  const run = rows[0];
  if (!run || !TYPED_SOURCES.has(run.source)) return 'no';
  return run.device === null ? 'yes' : 'device';
}

export async function mentionOrigin(db: Queryable, runId: string): Promise<SparkOrigin> {
  return (await typedOnTheMac(db, runId)) === 'yes' ? 'typed_mac' : 'other';
}
