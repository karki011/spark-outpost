import type { PrTicketSync, TicketSourceId } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export async function claimTicketSync(db: Queryable, pullId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE pr_watches SET ticket_sync_claimed_at = now()
     WHERE id = $1 AND ticket_sync_claimed_at IS NULL`,
    [pullId],
  );
  return (rowCount ?? 0) > 0;
}

export async function saveTicketSync(
  db: Queryable,
  pullId: string,
  entries: readonly PrTicketSync[],
): Promise<void> {
  await db.query('UPDATE pr_watches SET ticket_sync = $2, updated_at = now() WHERE id = $1', [
    pullId,
    JSON.stringify(entries),
  ]);
}

export interface KnownTicket {
  source: TicketSourceId;
  key: string;
}

export async function cachedTicketsNamed(
  db: Queryable,
  workspaceId: string,
  keys: readonly string[],
): Promise<KnownTicket[]> {
  if (keys.length === 0) return [];
  const { rows } = await db.query<KnownTicket>(
    `SELECT source, key FROM tickets WHERE workspace_id = $1 AND upper(key) = ANY($2::text[])
     ORDER BY source, key`,
    [workspaceId, keys.map((key) => key.toUpperCase())],
  );
  return rows;
}
