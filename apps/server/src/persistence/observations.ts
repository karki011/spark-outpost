import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export type ObservationSource = 'secret_file' | 'secret_output' | 'private_data' | 'web_page';

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

export async function conversationObservations(
  db: Queryable,
  conversationId: string,
): Promise<Observation[]> {
  const { rows } = await db.query<Observation>(
    `SELECT source, label FROM run_observations WHERE conversation_id = $1
     GROUP BY source, label ORDER BY min(created_at), label`,
    [conversationId],
  );
  return rows;
}
