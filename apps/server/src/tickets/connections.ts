import type {
  SaveTicketConnectionRequest,
  TicketConnections,
  TicketSourceId,
  UpdateTicketSettingsRequest,
} from '@spark-outpost/contracts';
import { ticketSourceNames } from '@spark-outpost/contracts';
import { probeConfluence, productsView } from '../atlassian/products.ts';
import { atlassianAccount, switchProducts } from '../atlassian/connect.ts';
import {
  checkServiceNow,
  recheckServiceNow,
  serviceNowAccessOf,
  switchServiceNowTypes,
} from '../servicenow/connect.ts';
import { liveTables } from '../servicenow/record-store.ts';
import { serviceNowSource } from '../servicenow/source.ts';
import { serviceNowView } from '../servicenow/view.ts';
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
  type ServiceNowRow,
  type TicketConnectionRow,
} from '../persistence/ticket-connections.ts';
import { forgetDevelopment } from '../persistence/ticket-development.ts';
import { recordTicketEvent } from '../persistence/ticket-events.ts';
import type { SecretStore, TicketSecretId } from '../setup/secrets.ts';
import { jiraSource } from './jira.ts';
import { LINEAR_API_URL, linearSource } from './linear.ts';
import {
  TicketApiError,
  TicketConflictError,
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
  connection: TicketConnectionRow,
  secret: string,
): TicketSource {
  if (connection.source === 'servicenow') {
    return serviceNowSource(serviceNowAccessOf(connection, secret), connection, deps.fetch);
  }
  if (connection.source === 'linear') {
    return linearSource(secret, connection, deps.fetch, connection.apiUrl);
  }
  return jiraSource(atlassianAccessOf(connection, secret), connection, deps.fetch);
}

const CONFLUENCE_RECHECK_MS = 10 * 60_000;
const confluenceChecks = new Map<string, number>();

function checkConfluenceLater(deps: TicketDeps, row: TicketConnectionRow, secret: string | null) {
  if (row.source !== 'jira' || row.confluenceReach !== null || !secret) return;
  const last = confluenceChecks.get(deps.workspaceId);
  if (last !== undefined && Date.now() - last < CONFLUENCE_RECHECK_MS) return;
  confluenceChecks.set(deps.workspaceId, Date.now());
  void probeConfluence(atlassianAccessOf(row, secret), deps.fetch)
    .then(async (confluenceReach) => {
      if (confluenceReach) {
        await saveAtlassianProducts(deps.db, deps.workspaceId, { confluenceReach });
      }
    })
    .catch(() => undefined);
}

export async function ticketConnections(deps: TicketDeps): Promise<TicketConnections> {
  const rows = await listTicketConnections(deps.db, deps.workspaceId);
  const connections = await Promise.all(
    rows.map(async (row) => {
      const secret = await savedSecret(deps, row.source);
      checkConfluenceLater(deps, row, secret);
      return {
        source: row.source,
        account: row.account,
        siteUrl: row.source === 'linear' ? null : row.apiUrl,
        validatedAt: row.validatedAt.toISOString(),
        keySaved: secret !== null,
        moveOnShip: row.moveOnShip,
        moveOnMerge: row.moveOnMerge,
        statusMap: row.statusMap,
        moveStatuses: row.moveStatuses,
        atlassian: row.source === 'jira' ? productsView(row) : null,
        servicenow: row.source === 'servicenow' ? serviceNowView(row) : null,
      };
    }),
  );
  return { connections };
}

const NO_SERVICENOW: ServiceNowRow = { authKind: null, login: null, serviceNowTypes: null };

function requestedAccess(deps: TicketDeps, request: SaveTicketConnectionRequest) {
  if (request.source === 'servicenow') {
    return {
      row: {
        source: 'servicenow' as const,
        apiUrl: request.instanceUrl,
        email: null,
        statusMap: {},
        moveStatuses: {},
        authKind: request.authKind,
        login: request.username,
        serviceNowTypes: null,
      },
      secret: request.authKind === 'basic' ? request.password : request.apiKey,
    };
  }
  if (request.source === 'linear') {
    return {
      row: {
        source: 'linear' as const,
        apiUrl: deps.linearApiUrl ?? LINEAR_API_URL,
        email: null,
        statusMap: {},
        moveStatuses: {},
        ...NO_SERVICENOW,
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
      ...NO_SERVICENOW,
    },
    secret: request.apiToken,
  };
}

interface Checked {
  who: TicketAccount;
  products?: AtlassianProductRow;
  serviceNow?: ServiceNowRow;
}

async function whoIs(
  deps: TicketDeps,
  row: ReturnType<typeof requestedAccess>['row'],
  secret: string,
): Promise<Checked> {
  if (row.source === 'jira') {
    return atlassianAccount(atlassianAccessOf(row, secret), deps.fetch);
  }
  if (row.source === 'servicenow') {
    const { who, types } = await checkServiceNow(serviceNowAccessOf(row, secret), deps.fetch, null);
    return {
      who,
      serviceNow: { authKind: row.authKind, login: row.login, serviceNowTypes: types },
    };
  }
  try {
    return { who: await linearSource(secret, row, deps.fetch, row.apiUrl).whoami() };
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
  const { who, products, serviceNow } = checked;
  await deps.secrets.set(secretIdFor(row.source), secret);
  await forgetDevelopment(deps.db, deps.workspaceId, row.source);
  await saveTicketConnection(deps.db, deps.workspaceId, {
    ...row,
    account: who.name,
    accountId: who.id,
    ...(products ? { products } : {}),
    ...(serviceNow ? { serviceNow } : {}),
  });
  await recordTicketEvent(deps.db, deps.workspaceId, {
    source: row.source,
    action: 'connect',
    outcome: 'succeeded',
    detail: {
      site: row.apiUrl,
      account: who.name,
      ...(products ? { products } : {}),
      ...(serviceNow ? { authKind: serviceNow.authKind, types: serviceNow.serviceNowTypes } : {}),
    },
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
  const { jiraOn, confluenceOn, serviceNowTypes, recheck, ...ticketSettings } = settings;
  if (source !== 'servicenow' && (recheck || serviceNowTypes)) {
    throw new TicketConflictError('Record types and Check connection are for ServiceNow only.');
  }
  if (source === 'servicenow' && (ticketSettings.moveOnShip || ticketSettings.moveOnMerge)) {
    throw new TicketConflictError(
      'ServiceNow tickets never move when a chat ships or merges: resolving tells the caller.',
    );
  }
  if (source !== 'servicenow' && ticketSettings.inboxScope) {
    throw new TicketConflictError('Me and my groups is for ServiceNow only.');
  }
  if (jiraOn !== undefined || confluenceOn !== undefined) {
    await switchProducts(deps, source, { jiraOn, confluenceOn });
  }
  if (source === 'servicenow' && recheck) await recheckServiceNow(deps);
  if (source === 'servicenow' && serviceNowTypes) {
    await switchServiceNowTypes(deps, serviceNowTypes);
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
  if (source === 'servicenow' && liveTables(connection.serviceNowTypes).length === 0) return null;
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
