import {
  ticketStatusMapSchema,
  type TicketSourceId,
  type TicketStatusMap,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface TicketConnectionRow {
  source: TicketSourceId;
  apiUrl: string;
  email: string | null;
  account: string;
  moveOnShip: boolean;
  statusMap: TicketStatusMap;
  validatedAt: Date;
}

interface Row {
  source: TicketSourceId;
  api_url: string;
  email: string | null;
  account: string;
  move_on_ship: boolean;
  status_map: unknown;
  validated_at: Date;
}

function toConnection(row: Row): TicketConnectionRow {
  const statusMap = ticketStatusMapSchema.safeParse(row.status_map);
  return {
    source: row.source,
    apiUrl: row.api_url,
    email: row.email,
    account: row.account,
    moveOnShip: row.move_on_ship,
    statusMap: statusMap.success ? statusMap.data : {},
    validatedAt: row.validated_at,
  };
}

export async function listTicketConnections(
  db: Queryable,
  workspaceId: string,
): Promise<TicketConnectionRow[]> {
  const { rows } = await db.query<Row>(
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
  const { rows } = await db.query<Row>(
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
}

export async function saveTicketConnection(
  db: Queryable,
  workspaceId: string,
  connection: SavedConnection,
): Promise<void> {
  await db.query(
    `INSERT INTO ticket_connections (workspace_id, source, api_url, email, account)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, source) DO UPDATE SET api_url = EXCLUDED.api_url,
       email = EXCLUDED.email, account = EXCLUDED.account, validated_at = now()`,
    [workspaceId, connection.source, connection.apiUrl, connection.email, connection.account],
  );
}

export async function updateTicketSettings(
  db: Queryable,
  workspaceId: string,
  source: TicketSourceId,
  settings: { moveOnShip?: boolean | undefined; statusMap?: TicketStatusMap | undefined },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE ticket_connections SET move_on_ship = COALESCE($3, move_on_ship),
       status_map = COALESCE($4::jsonb, status_map)
     WHERE workspace_id = $1 AND source = $2`,
    [
      workspaceId,
      source,
      settings.moveOnShip ?? null,
      settings.statusMap ? JSON.stringify(settings.statusMap) : null,
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
