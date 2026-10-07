import type {
  SaveTicketConnectionRequest,
  TicketConnections,
  TicketSourceId,
  UpdateTicketSettingsRequest,
} from '@spark-outpost/contracts';
import { ticketSourceNames } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  deleteTicketConnection,
  getTicketConnection,
  listTicketConnections,
  saveTicketAccountId,
  saveTicketConnection,
  updateTicketSettings,
  type TicketConnectionRow,
} from '../persistence/ticket-connections.ts';
import { forgetDevelopment } from '../persistence/ticket-development.ts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import type { SecretStore, TicketSecretId } from '../setup/secrets.ts';
import { jiraSource } from './jira.ts';
import { LINEAR_API_URL, linearSource } from './linear.ts';
import { TicketApiError, TicketNotConnectedError, type TicketSource } from './source.ts';

export interface TicketDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  linearApiUrl?: string | undefined;
}

export const secretIdFor = (source: TicketSourceId): TicketSecretId => `ticket:${source}`;

async function savedSecret(deps: TicketDeps, source: TicketSourceId): Promise<string | null> {
  return deps.secrets.get(secretIdFor(source)).catch(() => null);
}

function sourceFor(
  deps: TicketDeps,
  connection: Pick<TicketConnectionRow, 'source' | 'apiUrl' | 'email' | 'statusMap'>,
  secret: string,
): TicketSource {
  if (connection.source === 'linear') {
    return linearSource(secret, connection.statusMap, deps.fetch, connection.apiUrl);
  }
  return jiraSource(
    { siteUrl: connection.apiUrl, email: connection.email ?? '', apiToken: secret },
    connection.statusMap,
    deps.fetch,
  );
}

export async function ticketConnections(deps: TicketDeps): Promise<TicketConnections> {
  const rows = await listTicketConnections(deps.db, deps.workspaceId);
  const connections = await Promise.all(
    rows.map(async (row) => ({
      source: row.source,
      account: row.account,
      siteUrl: row.source === 'jira' ? row.apiUrl : null,
      validatedAt: row.validatedAt.toISOString(),
      keySaved: (await savedSecret(deps, row.source)) !== null,
      moveOnShip: row.moveOnShip,
      moveOnMerge: row.moveOnMerge,
      statusMap: row.statusMap,
    })),
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
      },
      secret: request.apiKey,
    };
  }
  return {
    row: { source: 'jira' as const, apiUrl: request.siteUrl, email: request.email, statusMap: {} },
    secret: request.apiToken,
  };
}

export async function saveConnection(
  deps: TicketDeps,
  request: SaveTicketConnectionRequest,
): Promise<TicketConnections> {
  const { row, secret } = requestedAccess(deps, request);
  const name = ticketSourceNames[row.source];
  let who: { id: string; name: string };
  try {
    who = await sourceFor(deps, row, secret).whoami();
  } catch (error) {
    await recordTicketEvent(deps.db, deps.workspaceId, {
      source: row.source,
      action: 'connect',
      outcome: 'failed',
      detail: { site: row.apiUrl, error: (error as Error).message },
    });
    if (error instanceof TicketApiError && error.status === 401) {
      throw new TicketApiError(
        401,
        `${name} rejected this key (401). Check that it's active and copied in full.`,
      );
    }
    throw error;
  }
  await deps.secrets.set(secretIdFor(row.source), secret);
  await forgetDevelopment(deps.db, deps.workspaceId, row.source);
  await saveTicketConnection(deps.db, deps.workspaceId, {
    ...row,
    account: who.name,
    accountId: who.id,
  });
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source: row.source,
    action: 'connect',
    outcome: 'succeeded',
    detail: { site: row.apiUrl, account: who.name },
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
  const changed = await updateTicketSettings(deps.db, deps.workspaceId, source, settings);
  if (!changed) throw new TicketNotConnectedError(`${ticketSourceNames[source]} isn't connected.`);
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source,
    action: 'settings',
    outcome: 'succeeded',
    detail: settings,
  });
  return ticketConnections(deps);
}

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
  const secret = await savedSecret(deps, source);
  if (!secret) return null;
  return { source: sourceFor(deps, connection, secret), connection };
}

export async function requireSource(deps: TicketDeps, source: TicketSourceId): Promise<OpenSource> {
  const open = await openSource(deps, source);
  if (!open) {
    throw new TicketNotConnectedError(
      `${ticketSourceNames[source]} isn't connected. Connect it in Settings → Connectors.`,
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
