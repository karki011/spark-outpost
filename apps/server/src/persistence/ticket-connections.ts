import { z } from 'zod';
import {
  serviceNowAuthKindSchema,
  serviceNowTypeIdSchema,
  ticketMoveStatusesSchema,
  type ServiceNowAuthKind,
  type ServiceNowTypeId,
  ticketStatusMapSchema,
  type TicketMoveStatuses,
  type TicketSourceId,
  type TicketStatusMap,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export type StoredReach = 'reachable' | 'denied' | null;

export interface AtlassianProductRow {
  jiraOn: boolean;
  jiraReach: StoredReach;
  confluenceOn: boolean;
  confluenceReach: StoredReach;
}

export type ServiceNowTypeRows = Record<ServiceNowTypeId, { on: boolean; reach: StoredReach }>;

const serviceNowTypeRowsSchema = z.record(
  serviceNowTypeIdSchema,
  z.object({ on: z.boolean(), reach: z.enum(['reachable', 'denied']).nullable() }),
);

export interface ServiceNowRow {
  authKind: ServiceNowAuthKind | null;
  login: string | null;
  serviceNowTypes: ServiceNowTypeRows | null;
}

export interface TicketConnectionRow extends AtlassianProductRow, ServiceNowRow {
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
  jira_on: boolean;
  jira_reach: StoredReach;
  confluence_on: boolean;
  confluence_reach: StoredReach;
  auth_kind: string | null;
  login: string | null;
  servicenow_types: unknown;
}

function toConnection(row: StoredTicketConnection): TicketConnectionRow {
  const statusMap = ticketStatusMapSchema.safeParse(row.status_map);
  const moveStatuses = ticketMoveStatusesSchema.safeParse(row.move_statuses);
  const authKind = serviceNowAuthKindSchema.safeParse(row.auth_kind);
  const types = serviceNowTypeRowsSchema.safeParse(row.servicenow_types);
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
    jiraOn: row.jira_on,
    jiraReach: row.jira_reach,
    confluenceOn: row.confluence_on,
    confluenceReach: row.confluence_reach,
    authKind: authKind.success ? authKind.data : null,
    login: row.login,
    serviceNowTypes: types.success ? types.data : null,
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
  products?: AtlassianProductRow;
  serviceNow?: ServiceNowRow;
}

export async function saveTicketConnection(
  db: Queryable,
  workspaceId: string,
  connection: SavedConnection,
): Promise<void> {
  const products = connection.products;
  const serviceNow = connection.serviceNow;
  await db.query(
    `INSERT INTO ticket_connections (workspace_id, source, api_url, email, account, account_id,
       jira_on, jira_reach, confluence_on, confluence_reach, auth_kind, login, servicenow_types)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (workspace_id, source) DO UPDATE SET api_url = EXCLUDED.api_url,
       email = EXCLUDED.email, account = EXCLUDED.account, account_id = EXCLUDED.account_id,
       jira_on = EXCLUDED.jira_on, jira_reach = EXCLUDED.jira_reach,
       confluence_on = EXCLUDED.confluence_on, confluence_reach = EXCLUDED.confluence_reach,
       auth_kind = EXCLUDED.auth_kind, login = EXCLUDED.login,
       servicenow_types = EXCLUDED.servicenow_types, validated_at = now()`,
    [
      workspaceId,
      connection.source,
      connection.apiUrl,
      connection.email,
      connection.account,
      connection.accountId,
      products?.jiraOn ?? true,
      products?.jiraReach ?? (connection.source === 'jira' ? 'reachable' : null),
      products?.confluenceOn ?? false,
      products?.confluenceReach ?? null,
      serviceNow?.authKind ?? null,
      serviceNow?.login ?? null,
      serviceNow?.serviceNowTypes ? JSON.stringify(serviceNow.serviceNowTypes) : null,
    ],
  );
}

export async function saveServiceNowCheck(
  db: Queryable,
  workspaceId: string,
  account: { id: string; name: string } | null,
  types: ServiceNowTypeRows,
): Promise<void> {
  await db.query(
    `UPDATE ticket_connections SET servicenow_types = $2::jsonb,
       account = COALESCE($3, account), account_id = COALESCE($4, account_id),
       validated_at = CASE WHEN $3::text IS NULL THEN validated_at ELSE now() END
     WHERE workspace_id = $1 AND source = 'servicenow'`,
    [workspaceId, JSON.stringify(types), account?.name ?? null, account?.id ?? null],
  );
}

export async function saveAtlassianProducts(
  db: Queryable,
  workspaceId: string,
  products: { [Key in keyof AtlassianProductRow]?: AtlassianProductRow[Key] | undefined },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE ticket_connections SET jira_on = COALESCE($2, jira_on),
       jira_reach = COALESCE($3, jira_reach),
       confluence_on = COALESCE($4, confluence_on),
       confluence_reach = COALESCE($5, confluence_reach)
     WHERE workspace_id = $1 AND source = 'jira'`,
    [
      workspaceId,
      products.jiraOn ?? null,
      products.jiraReach ?? null,
      products.confluenceOn ?? null,
      products.confluenceReach ?? null,
    ],
  );
  return (rowCount ?? 0) > 0;
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
