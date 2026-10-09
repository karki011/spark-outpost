import {
  ticketMoveStatusesSchema,
  ticketStatusMapSchema,
  type TicketMoveStatuses,
  type TicketSourceId,
  type TicketStatusMap,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface TicketConnectionRow {
  source: TicketSourceId;
  apiUrl: string;
  email: string | null;
  account: string;
  accountId: string | null;
  moveOnShip: boolean;
  moveOnMerge: boolean;
  statusMap: TicketStatusMap;
  moveStatuses: TicketMoveStatuses;
  validatedAt: Date;
}

interface StoredTicketConnection {
  source: TicketSourceId;
  api_url: string;
  email: string | null;
  account: string;
  account_id: string | null;
  move_on_ship: boolean;
  move_on_merge: boolean;
  status_map: unknown;
  move_statuses: unknown;
  validated_at: Date;
}

function toConnection(row: StoredTicketConnection): TicketConnectionRow {
  const statusMap = ticketStatusMapSchema.safeParse(row.status_map);
  const moveStatuses = ticketMoveStatusesSchema.safeParse(row.move_statuses);
  return {
    source: row.source,
    apiUrl: row.api_url,
    email: row.email,
    account: row.account,
    accountId: row.account_id,
    moveOnShip: row.move_on_ship,
    moveOnMerge: row.move_on_merge,
    statusMap: statusMap.success ? statusMap.data : {},
    moveStatuses: moveStatuses.success ? moveStatuses.data : {},
    validatedAt: row.validated_at,
  };
}

export async function listTicketConnections(
  db: Queryable,
  workspaceId: string,
): Promise<TicketConnectionRow[]> {
  const { rows } = await db.query<StoredTicketConnection>(
    'SELECT * FROM ticket_connections WHERE workspace_id = $1 ORDER BY source',
    [workspaceId],
  );
  return rows.map(toConnection);
}

export async function getTicketConnection(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
): Promise<TicketConnectionRow | null> {
  const { rows } = await db.query<StoredTicketConnection>(
    'SELECT * FROM ticket_connections WHERE workspace_id = $1 AND source = $2',
    [workspaceId, source],
  );
  return rows[0] ? toConnection(rows[0]) : null;
}

export interface SavedConnection {
  source: TicketSourceId;
  apiUrl: string;
  email: string | null;
  account: string;
  accountId: string;
}

export async function saveTicketConnection(
  db: Queryable,
  workspaceId: string,
  connection: SavedConnection,
): Promise<void> {
  await db.query(
    `INSERT INTO ticket_connections (workspace_id, source, api_url, email, account, account_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, source) DO UPDATE SET api_url = EXCLUDED.api_url,
       email = EXCLUDED.email, account = EXCLUDED.account, account_id = EXCLUDED.account_id,
       validated_at = now()`,
    [
      workspaceId,
      connection.source,
      connection.apiUrl,
      connection.email,
      connection.account,
      connection.accountId,
    ],
  );
}

export async function saveTicketAccountId(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
  accountId: string,
): Promise<void> {
  await db.query(
    'UPDATE ticket_connections SET account_id = $3 WHERE workspace_id = $1 AND source = $2',
    [workspaceId, source, accountId],
  );
}

export async function updateTicketSettings(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
  settings: {
    moveOnShip?: boolean | undefined;
    moveOnMerge?: boolean | undefined;
    statusMap?: TicketStatusMap | undefined;
    moveStatuses?: TicketMoveStatuses | undefined;
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE ticket_connections SET move_on_ship = COALESCE($3, move_on_ship),
       status_map = COALESCE($4::jsonb, status_map),
       move_on_merge = COALESCE($5, move_on_merge),
       move_statuses = COALESCE($6::jsonb, move_statuses)
     WHERE workspace_id = $1 AND source = $2`,
    [
      workspaceId,
      source,
      settings.moveOnShip ?? null,
      settings.statusMap ? JSON.stringify(settings.statusMap) : null,
      settings.moveOnMerge ?? null,
      settings.moveStatuses ? JSON.stringify(settings.moveStatuses) : null,
    ],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteTicketConnection(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
): Promise<void> {
  await db.query('DELETE FROM ticket_connections WHERE workspace_id = $1 AND source = $2', [
    workspaceId,
    source,
  ]);
}
