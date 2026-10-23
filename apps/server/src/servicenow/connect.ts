import { z } from 'zod';
import {
  SERVICENOW_NAME,
  serviceNowTables,
  serviceNowTypeIdSchema,
  serviceNowTypeNames,
  type ServiceNowTypeId,
} from '@spark-outpost/contracts';
import {
  getTicketConnection,
  saveServiceNowCheck,
  type ServiceNowTypeRows,
  type StoredReach,
  type TicketConnectionRow,
} from '../persistence/ticket-connections.ts';
import type { TicketDeps } from '../tickets/connections.ts';
import { failure, isOk, type JsonAnswer } from '../tickets/http.ts';
import {
  TicketApiError,
  TicketConflictError,
  TicketNotConnectedError,
  type TicketAccount,
} from '../tickets/source.ts';
import { serviceNowClient, type ServiceNowAccess, type ServiceNowClient } from './access.ts';

const PROBE_TIMEOUT_MS = 8_000;
const DENIED_STATUSES = new Set([401, 403, 404]);

const userSchema = z.object({
  result: z.array(
    z.object({
      sys_id: z.string(),
      user_name: z.string(),
      name: z.string().optional(),
    }),
  ),
});
const tableSchema = z.object({ result: z.array(z.unknown()) });

export interface ServiceNowCheck {
  who: TicketAccount;
  types: ServiceNowTypeRows;
}

const host = (instanceUrl: string) => new URL(instanceUrl).host;

function rejected(access: ServiceNowAccess): TicketApiError {
  const what = access.authKind === 'api_key' ? 'API key' : 'user name and password';
  return new TicketApiError(
    401,
    `${SERVICENOW_NAME} rejected this sign-in (401). Check the ${what}.`,
  );
}

async function tableReach(client: ServiceNowClient, table: string): Promise<StoredReach> {
  let answer: JsonAnswer;
  try {
    answer = await client.raw({
      method: 'GET',
      path: `/api/now/table/${table}`,
      query: { sysparm_limit: '1', sysparm_fields: 'sys_id' },
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof TicketApiError) return null;
    throw error;
  }
  if (isOk(answer)) return tableSchema.safeParse(answer.data).success ? 'reachable' : null;
  return DENIED_STATUSES.has(answer.status) ? 'denied' : null;
}

async function typeReach(client: ServiceNowClient, type: ServiceNowTypeId): Promise<StoredReach> {
  const reaches = await Promise.all(
    serviceNowTables[type].map((table) => tableReach(client, table)),
  );
  if (reaches.includes('reachable')) return 'reachable';
  return reaches.every((reach) => reach === 'denied') ? 'denied' : null;
}

async function probeTypes(
  client: ServiceNowClient,
): Promise<Record<ServiceNowTypeId, StoredReach>> {
  const types = serviceNowTypeIdSchema.options;
  const reaches = await Promise.all(types.map((type) => typeReach(client, type)));
  return Object.fromEntries(types.map((type, index) => [type, reaches[index]!])) as Record<
    ServiceNowTypeId,
    StoredReach
  >;
}

export async function whoAmI(
  client: ServiceNowClient,
  access: ServiceNowAccess,
): Promise<TicketAccount> {
  const answer = await client.raw({
    method: 'GET',
    path: '/api/now/table/sys_user',
    query: {
      sysparm_query: `user_name=${access.username}`,
      sysparm_fields: 'sys_id,user_name,name',
      sysparm_limit: '1',
    },
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (answer.status === 401) throw rejected(access);
  if (!isOk(answer)) throw failure(SERVICENOW_NAME, 'checking who you are', answer, 'user');
  const parsed = userSchema.safeParse(answer.data);
  if (!parsed.success) {
    throw new TicketApiError(
      502,
      `${host(access.instanceUrl)} didn't answer as ${SERVICENOW_NAME}. Check the instance address.`,
    );
  }
  const user = parsed.data.result[0];
  if (!user) {
    throw new TicketApiError(
      401,
      `${SERVICENOW_NAME} has no user named ${access.username} that this sign-in can see. Check the user name.`,
    );
  }
  return { id: user.sys_id, name: user.name?.trim() || user.user_name };
}

export async function checkServiceNow(
  access: ServiceNowAccess,
  fetchImpl: typeof fetch,
  current: ServiceNowTypeRows | null,
): Promise<ServiceNowCheck> {
  const client = serviceNowClient(access, fetchImpl);
  const who = await whoAmI(client, access);
  const reaches = await probeTypes(client);
  const types = Object.fromEntries(
    serviceNowTypeIdSchema.options.map((type) => {
      const reach = reaches[type];
      const on = current ? current[type].on && reach !== 'denied' : reach === 'reachable';
      return [type, { on, reach }];
    }),
  ) as ServiceNowTypeRows;
  return { who, types };
}

export function serviceNowAccessOf(
  connection: Pick<TicketConnectionRow, 'apiUrl' | 'authKind' | 'login'>,
  secret: string,
): ServiceNowAccess {
  return {
    instanceUrl: connection.apiUrl,
    authKind: connection.authKind ?? 'basic',
    username: connection.login ?? '',
    secret,
  };
}

export function uncheckedTypes(): ServiceNowTypeRows {
  return Object.fromEntries(
    serviceNowTypeIdSchema.options.map((type) => [type, { on: false, reach: null }]),
  ) as ServiceNowTypeRows;
}

async function savedConnection(deps: TicketDeps) {
  const connection = await getTicketConnection(deps.db, deps.workspaceId, 'servicenow');
  const secret = await deps.secrets.get('ticket:servicenow').catch(() => null);
  if (!connection || !secret) {
    throw new TicketNotConnectedError(`${SERVICENOW_NAME} isn't connected.`);
  }
  return { connection, access: serviceNowAccessOf(connection, secret) };
}

export async function recheckServiceNow(deps: TicketDeps): Promise<void> {
  const { connection, access } = await savedConnection(deps);
  let check: ServiceNowCheck;
  try {
    check = await checkServiceNow(access, deps.fetch, connection.serviceNowTypes);
  } catch (error) {
    if (error instanceof TicketApiError && error.status === 401) {
      throw new TicketApiError(
        401,
        `${SERVICENOW_NAME} rejected the saved sign-in (401). Disconnect it and connect again.`,
      );
    }
    throw error;
  }
  await saveServiceNowCheck(deps.db, deps.workspaceId, check.who, check.types);
}

function cantRead(type: ServiceNowTypeId): string {
  const name = serviceNowTypeNames[type];
  return `This account can't read ${name.toLowerCase()}, so ${name} stays off. Ask your admin for access, then check the connection.`;
}

export async function switchServiceNowTypes(
  deps: TicketDeps,
  wanted: Partial<Record<ServiceNowTypeId, boolean>>,
): Promise<void> {
  const { connection, access } = await savedConnection(deps);
  const types = { ...(connection.serviceNowTypes ?? uncheckedTypes()) };
  const client = serviceNowClient(access, deps.fetch);
  for (const type of serviceNowTypeIdSchema.options) {
    const on = wanted[type];
    if (on === undefined) continue;
    let reach = types[type].reach;
    if (on && reach !== 'reachable') reach = await typeReach(client, type);
    if (on && reach !== 'reachable') throw new TicketConflictError(cantRead(type));
    types[type] = { on, reach };
  }
  await saveServiceNowCheck(deps.db, deps.workspaceId, null, types);
}
