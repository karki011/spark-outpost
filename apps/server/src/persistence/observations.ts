import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export type ObservationSource =
  'secret_file' | 'secret_output' | 'private_data' | 'web_page' | 'mac_app' | 'calendar';

export interface Observation {
  source: ObservationSource;
  label: string;
}

export async function recordObservation(
  db: Queryable,
  runId: string,
  observation: Observation,
): Promise<void> {
  await db.query(
    `INSERT INTO run_observations (id, run_id, conversation_id, source, label)
     SELECT $1, r.id, r.conversation_id, $3, $4 FROM runs r WHERE r.id = $2
     ON CONFLICT (run_id, source, label) DO NOTHING`,
    [newId(), runId, observation.source, observation.label],
  );
}

export async function turnObservations(db: Queryable, runId: string): Promise<Observation[]> {
  const { rows } = await db.query<Observation>(
    `SELECT o.source, o.label FROM run_observations o
     JOIN runs seen ON seen.id = o.run_id
     JOIN runs current ON current.id = $1
     WHERE COALESCE(seen.parent_run_id, seen.id) = COALESCE(current.parent_run_id, current.id)
     GROUP BY o.source, o.label ORDER BY min(o.created_at), o.label`,
    [runId],
  );
  return rows;
}
