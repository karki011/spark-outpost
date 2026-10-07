import type { TicketSourceId } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface StoredDevelopment {
  key: string;
  outcome: 'ok' | 'unavailable';
  payload: unknown;
  fetchedAt: Date;
}

export async function storedDevelopment(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
  keys: readonly string[],
): Promise<Map<string, StoredDevelopment>> {
  if (keys.length === 0) return new Map();
  const { rows } = await db.query<{
    key: string;
    outcome: 'ok' | 'unavailable';
    payload: unknown;
    fetched_at: Date;
  }>(
    `SELECT key, outcome, payload, fetched_at FROM ticket_development
     WHERE workspace_id = $1 AND source = $2 AND key = ANY($3::text[])`,
    [workspaceId, source, [...keys]],
  );
  return new Map(
    rows.map((row) => [
      row.key,
      { key: row.key, outcome: row.outcome, payload: row.payload, fetchedAt: row.fetched_at },
    ]),
  );
}

export async function saveDevelopment(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
  key: string,
  payload: unknown,
  at: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO ticket_development (workspace_id, source, key, outcome, payload, fetched_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (workspace_id, source, key) DO UPDATE SET outcome = EXCLUDED.outcome,
       payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
    [
      workspaceId,
      source,
      key,
      payload === null ? 'unavailable' : 'ok',
      payload === null ? null : JSON.stringify(payload),
      at,
    ],
  );
}

export async function forgetDevelopment(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
): Promise<void> {
  await db.query('DELETE FROM ticket_development WHERE workspace_id = $1 AND source = $2', [
    workspaceId,
    source,
  ]);
}
