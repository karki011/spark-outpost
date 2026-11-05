import { z } from 'zod';
import {
  SERVICENOW_NAME,
  isReadOnlyTable,
  serviceNowTableNames,
  serviceNowTables,
  serviceNowTypeIdSchema,
  type ServiceNowInboxScope,
  type ServiceNowTable,
  type TicketComment,
} from '@spark-outpost/contracts';
import type { ServiceNowTypeRows } from '../persistence/ticket-connections.ts';
import type { SourceMoveSettings } from '../tickets/move-target.ts';
import { TicketApiError, TicketConflictError } from '../tickets/source.ts';
import { serviceNowClient, type ServiceNowAccess, type ServiceNowClient } from './access.ts';
import { readAttachments } from './attachments.ts';
import { whoAmI } from './connect.ts';
import { readJournal } from './journal.ts';
import { groupsQuery, numberQuery } from './query.ts';
import { recordsSchema, valueOf, type ServiceNowRecord } from './records.ts';

const groupsSchema = z.object({
  result: z.array(
    z.object({
      group: z
        .union([z.string(), z.object({ value: z.string() }).transform((group) => group.value)])
        .nullable()
        .catch(null),
    }),
  ),
});
const patchedSchema = z.object({ result: z.unknown() });

export interface RecordConnection extends SourceMoveSettings {
  apiUrl: string;
  accountId: string | null;
  serviceNowTypes: ServiceNowTypeRows | null;
  inboxScope: ServiceNowInboxScope;
}

export interface Located {
  table: ServiceNowTable;
  record: ServiceNowRecord;
}

export interface ReadRecord extends Located {
  comments: TicketComment[];
  attachments: { name: string; bytes: number }[];
}

const located = new Map<string, ServiceNowTable>();

export function liveTables(types: ServiceNowTypeRows | null): ServiceNowTable[] {
  if (!types) return [];
  return serviceNowTypeIdSchema.options
    .filter((type) => types[type].on && types[type].reach === 'reachable')
    .flatMap((type) => serviceNowTables[type]);
}

const PREFIX_TABLE: Record<string, ServiceNowTable> = {
  INC: 'incident',
  RITM: 'sc_req_item',
  SCTASK: 'sc_task',
  CHG: 'change_request',
  PRB: 'problem',
};

function guessTable(key: string): ServiceNowTable | null {
  const prefix = /^[A-Z]+/.exec(key)?.[0] ?? '';
  return PREFIX_TABLE[prefix] ?? null;
}

export function readOnlyRefusal(key: string): TicketConflictError {
  return new TicketConflictError(
    `${key} is a change request. Changes are read only in Spark; nothing changed.`,
  );
}

const isDenied = (error: unknown) => error instanceof TicketApiError && error.status === 403;

export async function fromTables<T>(
  wanted: readonly ServiceNowTable[],
  read: (table: ServiceNowTable) => Promise<T[]>,
): Promise<T[]> {
  const settled = await Promise.allSettled(wanted.map(read));
  const failed = settled.flatMap((entry) => (entry.status === 'rejected' ? [entry.reason] : []));
  const fatal = failed.find((reason) => !isDenied(reason));
  if (fatal !== undefined) throw fatal;
  if (failed.length > 0 && failed.length === settled.length) throw failed[0];
  return settled.flatMap((entry) => (entry.status === 'fulfilled' ? entry.value : []));
}

export interface ListPage {
  limit: number;
  offset?: number;
}

export function recordStore(
  access: ServiceNowAccess,
  connection: RecordConnection,
  fetchImpl: typeof fetch,
) {
  const client: ServiceNowClient = serviceNowClient(access, fetchImpl);
  const tables = liveTables(connection.serviceNowTypes);
  const cacheKey = (key: string) => `${access.instanceUrl}|${key}`;
  const whoami = () => whoAmI(client, access);

  async function me(): Promise<string> {
    if (connection.accountId) return connection.accountId;
    return (await whoami()).id;
  }

  async function list(
    table: ServiceNowTable,
    query: string,
    fields: readonly string[],
    page: ListPage,
  ) {
    const answer = await client.call(
      recordsSchema,
      {
        method: 'GET',
        path: `/api/now/table/${table}`,
        query: {
          sysparm_query: query,
          sysparm_fields: fields.join(','),
          sysparm_display_value: 'all',
          sysparm_exclude_reference_link: 'true',
          sysparm_limit: String(page.limit),
          ...(page.offset ? { sysparm_offset: String(page.offset) } : {}),
        },
      },
      `reading ${serviceNowTableNames[table].toLowerCase()} records`,
    );
    return answer.result;
  }

  async function groups(user: string): Promise<string[]> {
    const answer = await client.call(
      groupsSchema,
      {
        method: 'GET',
        path: '/api/now/table/sys_user_grmember',
        query: {
          sysparm_query: groupsQuery(user),
          sysparm_fields: 'group',
          sysparm_exclude_reference_link: 'true',
          sysparm_limit: '100',
        },
      },
      'reading your groups',
    );
    return answer.result.flatMap((row) => (row.group ? [row.group] : []));
  }

  async function locate(key: string, fields: readonly string[]): Promise<Located> {
    const number = key.trim().toUpperCase();
    const query = numberQuery(number);
    const known = located.get(cacheKey(number)) ?? guessTable(number);
    const order = [...new Set([known, ...tables].filter((table) => table !== null))];
    for (const table of order) {
      if (!tables.includes(table)) continue;
      const [record] = await list(table, query, fields, { limit: 1 }).catch((error: unknown) => {
        if (isDenied(error) && order.length > 1) return [];
        throw error;
      });
      if (!record) continue;
      located.set(cacheKey(number), table);
      return { table, record };
    }
    throw new TicketApiError(
      404,
      `${SERVICENOW_NAME} has no record ${number} that Spark may read. Check its record type is on in Settings → Connectors.`,
    );
  }

  async function writable(key: string, fields: readonly string[]): Promise<Located> {
    const found = await locate(key, fields);
    if (isReadOnlyTable(found.table)) throw readOnlyRefusal(key);
    return found;
  }

  async function read(key: string, fields: readonly string[]): Promise<ReadRecord> {
    const found = await locate(key, fields);
    const sysId = valueOf(found.record.sys_id);
    const [comments, attachments] = await Promise.all([
      readJournal(client, found.table, sysId),
      readAttachments(client, sysId),
    ]);
    return { ...found, comments, attachments };
  }

  async function patch(
    target: { table: ServiceNowTable; sysId: string },
    body: Record<string, string>,
    action: string,
  ) {
    await client.call(
      patchedSchema,
      {
        method: 'PATCH',
        path: `/api/now/table/${target.table}/${target.sysId}`,
        query: { sysparm_fields: 'sys_id' },
        body,
      },
      action,
    );
  }

  return { client, tables, whoami, me, groups, list, locate, writable, read, patch };
}

export type RecordStore = ReturnType<typeof recordStore>;
