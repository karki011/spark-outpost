import type {
  SaveTicketConnectionRequest,
  TicketConnections,
  TicketSourceId,
  UpdateTicketSettingsRequest,
} from '@spark-outpost/contracts';
import { ticketSourceNames } from '@spark-outpost/contracts';
import { probeConfluence, productsView } from '../atlassian/products.ts';
import { atlassianAccount, switchProducts } from '../atlassian/connect.ts';
import type { Db } from '../persistence/db.ts';
import {
  deleteTicketConnection,
  getTicketConnection,
  listTicketConnections,
  saveAtlassianProducts,
  saveTicketAccountId,
  saveTicketConnection,
  updateTicketSettings,
  type AtlassianProductRow,
  type TicketConnectionRow,
} from '../persistence/ticket-connections.ts';
import { forgetDevelopment } from '../persistence/ticket-development.ts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import type { SecretStore, TicketSecretId } from '../setup/secrets.ts';
import { jiraSource } from './jira.ts';
import { LINEAR_API_URL, linearSource } from './linear.ts';
import {
  TicketApiError,
  TicketNotConnectedError,
  type TicketAccount,
  type TicketSource,
} from './source.ts';

export interface TicketDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  linearApiUrl?: string | undefined;
}

export const secretIdFor = (source: TicketSourceId): TicketSecretId => `ticket:${source}`;

export async function savedSecret(
  deps: TicketDeps,
  source: TicketSourceId,
): Promise<string | null> {
  return deps.secrets.get(secretIdFor(source)).catch(() => null);
}

export function atlassianAccessOf(
  connection: Pick<TicketConnectionRow, 'apiUrl' | 'email'>,
  secret: string,
) {
  return { siteUrl: connection.apiUrl, email: connection.email ?? '', apiToken: secret };
}

function sourceFor(
  deps: TicketDeps,
  connection: Pick<
    TicketConnectionRow,
    'source' | 'apiUrl' | 'email' | 'statusMap' | 'moveStatuses'
  >,
  secret: string,
): TicketSource {
  if (connection.source === 'linear') {
    return linearSource(secret, connection, deps.fetch, connection.apiUrl);
  }
  return jiraSource(atlassianAccessOf(connection, secret), connection, deps.fetch);
}

async function checkedRow(
  deps: TicketDeps,
  row: TicketConnectionRow,
  secret: string | null,
): Promise<TicketConnectionRow> {
  if (row.source !== 'jira' || row.confluenceReach !== null || !secret) return row;
  const confluenceReach = await probeConfluence(atlassianAccessOf(row, secret), deps.fetch);
  if (!confluenceReach) return row;
  await saveAtlassianProducts(deps.db, deps.workspaceId, { confluenceReach });
  return { ...row, confluenceReach };
}

export async function ticketConnections(deps: TicketDeps): Promise<TicketConnections> {
  const rows = await listTicketConnections(deps.db, deps.workspaceId);
  const connections = await Promise.all(
    rows.map(async (stored) => {
      const secret = await savedSecret(deps, stored.source);
      const row = await checkedRow(deps, stored, secret);
      return {
        source: row.source,
        account: row.account,
        siteUrl: row.source === 'jira' ? row.apiUrl : null,
        validatedAt: row.validatedAt.toISOString(),
        keySaved: secret !== null,
        moveOnShip: row.moveOnShip,
        moveOnMerge: row.moveOnMerge,
        statusMap: row.statusMap,
        moveStatuses: row.moveStatuses,
        atlassian: row.source === 'jira' ? productsView(row) : null,
      };
    }),
  );
  return { connections };
}

function requestedAccess(deps: TicketDeps, request: SaveTicketConnectionRequest) {
  if (request.source === 'linear') {
    return {
      row: {
        source: 'linear' as const,
        apiUrl: deps.linearApiUrl ?? LINEAR_API_URL,
        email: null,
        statusMap: {},
        moveStatuses: {},
      },
      secret: request.apiKey,
    };
  }
  return {
    row: {
      source: 'jira' as const,
      apiUrl: request.siteUrl,
      email: request.email,
      statusMap: {},
      moveStatuses: {},
    },
    secret: request.apiToken,
  };
}

interface Checked {
  who: TicketAccount;
  products?: AtlassianProductRow;
}

async function whoIs(
  deps: TicketDeps,
  row: ReturnType<typeof requestedAccess>['row'],
  secret: string,
): Promise<Checked> {
  if (row.source === 'jira') {
    return atlassianAccount(atlassianAccessOf(row, secret), deps.fetch);
  }
  try {
    return { who: await sourceFor(deps, row, secret).whoami() };
  } catch (error) {
    if (error instanceof TicketApiError && error.status === 401) {
      throw new TicketApiError(
        401,
        `${ticketSourceNames[row.source]} rejected this key (401). Check that it's active and copied in full.`,
      );
    }
    throw error;
  }
}

export async function saveConnection(
  deps: TicketDeps,
  request: SaveTicketConnectionRequest,
): Promise<TicketConnections> {
  const { row, secret } = requestedAccess(deps, request);
  let checked: Checked;
  try {
    checked = await whoIs(deps, row, secret);
  } catch (error) {
    await recordTicketEvent(deps.db, deps.workspaceId, {
      source: row.source,
      action: 'connect',
      outcome: 'failed',
      detail: { site: row.apiUrl, error: (error as Error).message },
    });
    throw error;
  }
  const { who, products } = checked;
  await deps.secrets.set(secretIdFor(row.source), secret);
  await forgetDevelopment(deps.db, deps.workspaceId, row.source);
  await saveTicketConnection(deps.db, deps.workspaceId, {
    ...row,
    account: who.name,
    accountId: who.id,
    ...(products ? { products } : {}),
  });
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source: row.source,
    action: 'connect',
    outcome: 'succeeded',
    detail: { site: row.apiUrl, account: who.name, ...(products ? { products } : {}) },
  });
  return ticketConnections(deps);
}

export async function removeConnection(
  deps: TicketDeps,
  source: TicketSourceId,
): Promise<TicketConnections> {
  await deleteTicketConnection(deps.db, deps.workspaceId, source);
  await forgetDevelopment(deps.db, deps.workspaceId, source);
  await deps.secrets.delete(secretIdFor(source)).catch(() => undefined);
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source,
    action: 'disconnect',
    outcome: 'succeeded',
  });
  return ticketConnections(deps);
}

export async function changeSettings(
  deps: TicketDeps,
  source: TicketSourceId,
  settings: UpdateTicketSettingsRequest,
): Promise<TicketConnections> {
  const { jiraOn, confluenceOn, ...ticketSettings } = settings;
  if (jiraOn !== undefined || confluenceOn !== undefined) {
    await switchProducts(deps, source, { jiraOn, confluenceOn });
  }
  const changesTickets = Object.values(ticketSettings).some((value) => value !== undefined);
  const changed =
    !changesTickets ||
    (await updateTicketSettings(deps.db, deps.workspaceId, source, ticketSettings));
  if (!changed) throw new TicketNotConnectedError(`${ticketSourceNames[source]} isn't connected.`);
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source,
    action: 'settings',
    outcome: 'succeeded',
    detail: settings,
  });
  return ticketConnections(deps);
}

export const jiraLive = (connection: TicketConnectionRow) =>
  connection.jiraOn && connection.jiraReach === 'reachable';

export const confluenceLive = (connection: TicketConnectionRow) =>
  connection.confluenceOn && connection.confluenceReach === 'reachable';

export interface OpenSource {
  source: TicketSource;
  connection: TicketConnectionRow;
}

export async function openSource(
  deps: TicketDeps,
  source: TicketSourceId,
): Promise<OpenSource | null> {
  const connection = await getTicketConnection(deps.db, deps.workspaceId, source);
  if (!connection) return null;
  if (source === 'jira' && !jiraLive(connection)) return null;
  const secret = await savedSecret(deps, source);
  if (!secret) return null;
  return { source: sourceFor(deps, connection, secret), connection };
}

export async function requireSource(deps: TicketDeps, source: TicketSourceId): Promise<OpenSource> {
  const open = await openSource(deps, source);
  if (!open) {
    throw new TicketNotConnectedError(
      source === 'jira'
        ? "Jira isn't on. Connect Atlassian in Settings → Connectors and turn on Jira."
        : `${ticketSourceNames[source]} isn't connected. Connect it in Settings → Connectors.`,
    );
  }
  return open;
}

export async function connectedSources(deps: TicketDeps): Promise<OpenSource[]> {
  const rows = await listTicketConnections(deps.db, deps.workspaceId);
  const open = await Promise.all(rows.map((row) => openSource(deps, row.source)));
  return open.filter((entry): entry is OpenSource => entry !== null);
}

export async function accountIdOf(deps: TicketDeps, open: OpenSource): Promise<string> {
  if (open.connection.accountId) return open.connection.accountId;
  const { id } = await open.source.whoami();
  await saveTicketAccountId(deps.db, deps.workspaceId, open.connection.source, id);
  return id;
}
