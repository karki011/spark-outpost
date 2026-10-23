import {
  SERVICENOW_NAME,
  serviceNowTableSchema,
  type ServiceNowTable,
  type TicketDetail,
  type TicketRef,
  type TicketSummary,
} from '@spark-outpost/contracts';
import { planMove, type MovePlan, type MoveRequest } from '../tickets/move-target.ts';
import {
  daysAgo,
  matchesFilter,
  SEARCH_PAGE_SIZE,
  TicketConflictError,
  type TicketFilter,
  type TicketSource,
} from '../tickets/source.ts';
import type { ServiceNowAccess } from './access.ts';
import { inboxQuery, searchQuery } from './query.ts';
import {
  DETAIL_FIELDS,
  RECORD_FIELDS,
  shownOf,
  summaryOf,
  valueOf,
  type ServiceNowRecord,
} from './records.ts';
import { fromTables, recordStore, type Located, type RecordConnection } from './record-store.ts';
import { readStates } from './state-list.ts';
import { isFinalState, serviceNowSettings, stateOf } from './states.ts';

const PAGE_SIZE = 100;
const MOVE_FIELDS = ['sys_id', 'number', 'state', 'sys_class_name'];

export function finalRefusalMessage(key: string, to: string): string {
  return `${key} was not moved to ${to}: resolving, closing or cancelling tells the caller, so Spark doesn't do it with a ticket move. Do it in ServiceNow.`;
}

function finalRefusal(plan: MovePlan, key: string, to: string): MovePlan {
  return {
    ...plan,
    to: null,
    status: null,
    rule: null,
    stopped: 'refused',
    message: finalRefusalMessage(key, to),
  };
}

const target = (found: Located) => ({ table: found.table, sysId: valueOf(found.record.sys_id) });

export function serviceNowSource(
  access: ServiceNowAccess,
  connection: RecordConnection,
  fetchImpl: typeof fetch,
): TicketSource {
  const store = recordStore(access, connection, fetchImpl);
  const { client, tables } = store;

  const groups = (user: string) =>
    connection.inboxScope === 'me' ? Promise.resolve([]) : store.groups(user);

  const summary = (record: ServiceNowRecord, table: ServiceNowTable) =>
    summaryOf(record, {
      instanceUrl: access.instanceUrl,
      table,
      settings: serviceNowSettings(connection, table),
    });

  const listed = (wanted: readonly ServiceNowTable[], query: string, limit: number) =>
    fromTables(wanted, async (table) =>
      (await store.list(table, query, RECORD_FIELDS, { limit })).map((record) =>
        summary(record, table),
      ),
    );

  const wantedTables = (project: string | undefined) =>
    project ? tables.filter((table) => table === project) : tables;

  async function gatherMove(key: string, request: MoveRequest) {
    const found = await store.writable(key, MOVE_FIELDS);
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
    const next = plan.to ? (states.find((state) => state.name === plan.to) ?? null) : null;
    if (plan.to && isFinalState(plan.to)) {
      return { plan: finalRefusal(plan, key, plan.to), found, next: null };
    }
    return { plan, found, next };
  }

  const writeNote = async (
    key: string,
    field: 'work_notes' | 'comments',
    body: string,
    action: string,
  ) => store.patch(target(await store.writable(key, MOVE_FIELDS)), { [field]: body }, action);

  const source: TicketSource = {
    id: 'servicenow',
    whoami: store.whoami,
    async listAssigned(filter: TicketFilter): Promise<TicketSummary[]> {
      const user = await store.me();
      const query = inboxQuery({
        me: user,
        groups: await groups(user),
        scope: connection.inboxScope,
        status: filter.status,
      });
      const tickets = await listed(wantedTables(filter.project), query, PAGE_SIZE);
      const since = filter.doneWithinDays ? daysAgo(filter.doneWithinDays).toISOString() : null;
      return tickets
        .filter((ticket) => matchesFilter(ticket, filter))
        .filter((ticket) => !since || (ticket.doneAt ?? ticket.updatedAt) >= since);
    },
    async search(filter) {
      const query = searchQuery({
        text: filter.q,
        me: await store.me(),
        assignee: filter.assignee,
        status: filter.status,
      });
      const tickets = await listed(wantedTables(filter.project), query, SEARCH_PAGE_SIZE);
      return tickets
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, SEARCH_PAGE_SIZE);
    },
    async getSummary(key) {
      const found = await store.locate(key, RECORD_FIELDS);
      return summary(found.record, found.table);
    },
    async getTicket(key): Promise<TicketDetail> {
      const found = await store.read(key, DETAIL_FIELDS);
      return {
        ...summary(found.record, found.table),
        description: shownOf(found.record.description),
        assignee: shownOf(found.record.assigned_to) || null,
        comments: found.comments,
        links: [],
        subtasks: [],
        attachments: found.attachments,
      };
    },
    async assign(key, accountId) {
      const found = await store.writable(key, MOVE_FIELDS);
      await store.patch(target(found), { assigned_to: accountId ?? '' }, `assigning ${key}`);
    },
    async planMove(key, request) {
      return (await gatherMove(key, request)).plan;
    },
    async transition(key, request) {
      const { plan, found, next } = await gatherMove(key, request);
      if (!next || plan.stopped) return { ...plan, moved: false };
      await store.patch(target(found), { state: next.value }, `moving ${key}`);
      return { ...plan, moved: true };
    },
    async projectStatuses(project) {
      return readStates(client, serviceNowTableSchema.parse(project));
    },
    async comment(key, body) {
      await writeNote(key, 'work_notes', body, `adding a work note to ${key}`);
    },
    async customerComment(key, body) {
      await writeNote(key, 'comments', body, `adding a comment to ${key}`);
    },
    async linkPullRequest(key, pull: TicketRef) {
      const note = `Pull request: ${pull.title}\n${pull.url}`;
      await writeNote(key, 'work_notes', note, `linking a pull request to ${key}`);
    },
    async create() {
      throw new TicketConflictError(
        'ServiceNow records are opened in ServiceNow. Spark reads and updates them but does not create them.',
      );
    },
  };
  return source;
}
