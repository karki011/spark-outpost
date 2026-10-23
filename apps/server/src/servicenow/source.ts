import { z } from 'zod';
import {
  SERVICENOW_NAME,
  isReadOnlyTable,
  serviceNowTableNames,
  serviceNowTableSchema,
  serviceNowTables,
  serviceNowTypeIdSchema,
  type ServiceNowInboxScope,
  type ServiceNowTable,
  type TicketDetail,
  type TicketRef,
  type TicketSummary,
} from '@spark-outpost/contracts';
import type { ServiceNowTypeRows } from '../persistence/ticket-connections.ts';
import {
  planMove,
  type MovePlan,
  type MoveRequest,
  type SourceMoveSettings,
} from '../tickets/move-target.ts';
import {
  daysAgo,
  matchesFilter,
  SEARCH_PAGE_SIZE,
  TicketApiError,
  TicketConflictError,
  type TicketFilter,
  type TicketSource,
} from '../tickets/source.ts';
import { serviceNowClient, type ServiceNowAccess } from './access.ts';
import { whoAmI } from './connect.ts';
import { readAttachments } from './attachments.ts';
import { readJournal } from './journal.ts';
import { groupsQuery, inboxQuery, numberQuery, searchQuery } from './query.ts';
import {
  DETAIL_FIELDS,
  RECORD_FIELDS,
  recordsSchema,
  shownOf,
  summaryOf,
  valueOf,
  type ServiceNowRecord,
} from './records.ts';
import { readStates } from './state-list.ts';
import { isFinalState, serviceNowSettings, stateOf } from './states.ts';

const PAGE_SIZE = 100;
const groupsSchema = z.object({
  result: z.array(z.object({ group: z.object({ value: z.string() }).nullable().catch(null) })),
});
const patchedSchema = z.object({ result: z.unknown() });

export interface TicketSourceConnection extends SourceMoveSettings {
  apiUrl: string;
  accountId: string | null;
  serviceNowTypes: ServiceNowTypeRows | null;
  inboxScope: ServiceNowInboxScope;
}

interface Located {
  table: ServiceNowTable;
  record: ServiceNowRecord;
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

function readOnlyRefusal(key: string): TicketConflictError {
  return new TicketConflictError(
    `${key} is a change request. Changes are read only in Spark; nothing changed.`,
  );
}

function finalRefusal(plan: MovePlan, key: string, to: string): MovePlan {
  return {
    ...plan,
    to: null,
    status: null,
    rule: null,
    stopped: 'refused',
    message: `${key} was not moved to ${to}: resolving, closing or cancelling tells the caller, so Spark doesn't do it with a ticket move. Do it in ServiceNow.`,
  };
}

export function serviceNowSource(
  access: ServiceNowAccess,
  connection: TicketSourceConnection,
  fetchImpl: typeof fetch,
): TicketSource {
  const client = serviceNowClient(access, fetchImpl);
  const tables = liveTables(connection.serviceNowTypes);
  const cacheKey = (key: string) => `${access.instanceUrl}|${key}`;

  async function me(): Promise<string> {
    if (connection.accountId) return connection.accountId;
    return (await whoami()).id;
  }

  const whoami = () => whoAmI(client, access);

  async function list(
    table: ServiceNowTable,
    query: string,
    fields: readonly string[],
    limit: number,
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
          sysparm_limit: String(limit),
        },
      },
      `reading ${serviceNowTableNames[table].toLowerCase()} records`,
    );
    return answer.result;
  }

  async function groups(user: string): Promise<string[]> {
    if (connection.inboxScope === 'me') return [];
    const answer = await client.call(
      groupsSchema,
      {
        method: 'GET',
        path: '/api/now/table/sys_user_grmember',
        query: { sysparm_query: groupsQuery(user), sysparm_fields: 'group', sysparm_limit: '100' },
      },
      'reading your groups',
    );
    return answer.result.flatMap((row) => (row.group ? [row.group.value] : []));
  }

  const summary = (record: ServiceNowRecord, table: ServiceNowTable) =>
    summaryOf(record, {
      instanceUrl: access.instanceUrl,
      table,
      settings: serviceNowSettings(connection, table),
    });

  async function locate(key: string, fields: readonly string[]): Promise<Located> {
    const number = key.trim().toUpperCase();
    const query = numberQuery(number);
    const known = located.get(cacheKey(number)) ?? guessTable(number);
    const order = [...new Set([known, ...tables].filter((table) => table !== null))];
    for (const table of order) {
      if (!tables.includes(table)) continue;
      const [record] = await list(table, query, fields, 1);
      if (!record) continue;
      located.set(cacheKey(number), table);
      return { table, record };
    }
    throw new TicketApiError(
      404,
      `${SERVICENOW_NAME} has no record ${number} that Spark may read. Check its record type is on in Settings → Connectors.`,
    );
  }

  async function writable(key: string): Promise<Located> {
    const found = await locate(key, ['sys_id', 'number', 'state', 'sys_class_name']);
    if (isReadOnlyTable(found.table)) throw readOnlyRefusal(key);
    return found;
  }

  async function patch(found: Located, body: Record<string, string>, action: string) {
    await client.call(
      patchedSchema,
      {
        method: 'PATCH',
        path: `/api/now/table/${found.table}/${valueOf(found.record.sys_id)}`,
        query: { sysparm_fields: 'sys_id' },
        body,
      },
      action,
    );
  }

  async function gatherMove(key: string, request: MoveRequest) {
    const found = await locate(key, ['sys_id', 'number', 'state', 'sys_class_name']);
    if (isReadOnlyTable(found.table)) throw readOnlyRefusal(key);
    const states = await readStates(client, found.table);
    const current = stateOf(valueOf(found.record.state), shownOf(found.record.state));
    const plan = planMove({
      key,
      sourceName: SERVICENOW_NAME,
      project: found.table,
      current,
      statuses: states,
      reachable: null,
      request,
      settings: serviceNowSettings(connection, found.table),
    });
    const target = plan.to ? (states.find((state) => state.name === plan.to) ?? null) : null;
    if (plan.to && isFinalState(plan.to)) {
      return { plan: finalRefusal(plan, key, plan.to), found, target: null };
    }
    return { plan, found, target };
  }

  const source: TicketSource = {
    id: 'servicenow',
    whoami,
    async listAssigned(filter: TicketFilter): Promise<TicketSummary[]> {
      const user = await me();
      const groupIds = await groups(user);
      const query = inboxQuery({
        me: user,
        groups: groupIds,
        scope: connection.inboxScope,
        status: filter.status,
      });
      const wanted = filter.project ? tables.filter((table) => table === filter.project) : tables;
      const lists = await Promise.all(
        wanted.map(async (table) =>
          (await list(table, query, RECORD_FIELDS, PAGE_SIZE)).map((record) =>
            summary(record, table),
          ),
        ),
      );
      const since = filter.doneWithinDays ? daysAgo(filter.doneWithinDays).toISOString() : null;
      return lists
        .flat()
        .filter((ticket) => matchesFilter(ticket, filter))
        .filter((ticket) => !since || (ticket.doneAt ?? ticket.updatedAt) >= since);
    },
    async search(filter) {
      const user = await me();
      const query = searchQuery({
        text: filter.q,
        me: user,
        assignee: filter.assignee,
        status: filter.status,
      });
      const wanted = filter.project ? tables.filter((table) => table === filter.project) : tables;
      const lists = await Promise.all(
        wanted.map(async (table) =>
          (await list(table, query, RECORD_FIELDS, SEARCH_PAGE_SIZE)).map((record) =>
            summary(record, table),
          ),
        ),
      );
      return lists
        .flat()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, SEARCH_PAGE_SIZE);
    },
    async getSummary(key) {
      const found = await locate(key, RECORD_FIELDS);
      return summary(found.record, found.table);
    },
    async getTicket(key): Promise<TicketDetail> {
      const found = await locate(key, DETAIL_FIELDS);
      const sysId = valueOf(found.record.sys_id);
      const [comments, attachments] = await Promise.all([
        readJournal(client, found.table, sysId),
        readAttachments(client, sysId),
      ]);
      return {
        ...summary(found.record, found.table),
        description: shownOf(found.record.description),
        assignee: shownOf(found.record.assigned_to) || null,
        comments,
        links: [],
        subtasks: [],
        attachments,
      };
    },
    async assign(key, accountId) {
      const found = await writable(key);
      await patch(found, { assigned_to: accountId ?? '' }, `assigning ${key}`);
    },
    async planMove(key, request) {
      return (await gatherMove(key, request)).plan;
    },
    async transition(key, request) {
      const { plan, found, target } = await gatherMove(key, request);
      if (!target || plan.stopped) return { ...plan, moved: false };
      await patch(found, { state: target.value }, `moving ${key}`);
      return { ...plan, moved: true };
    },
    async projectStatuses(project) {
      const table = serviceNowTableSchema.parse(project);
      return readStates(client, table);
    },
    async comment(key, body) {
      await patch(await writable(key), { work_notes: body }, `adding a work note to ${key}`);
    },
    async customerComment(key, body) {
      await patch(await writable(key), { comments: body }, `adding a comment to ${key}`);
    },
    async linkPullRequest(key, pull: TicketRef) {
      const note = `Pull request: ${pull.title}\n${pull.url}`;
      await patch(await writable(key), { work_notes: note }, `linking a pull request to ${key}`);
    },
    async create() {
      throw new TicketConflictError(
        'ServiceNow records are opened in ServiceNow. Spark reads and updates them but does not create them.',
      );
    },
  };
  return source;
}
