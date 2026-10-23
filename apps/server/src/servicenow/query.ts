import {
  isTicketKey,
  type ServiceNowInboxScope,
  type TicketAssigneeFilter,
  type TicketStatus,
} from '@spark-outpost/contracts';

const SYS_ID = /^[A-Za-z0-9_-]{1,64}$/;
const QUERY_BREAKERS = /[\^\r\n\t]/g;
const NEWEST_FIRST = 'ORDERBYDESCsys_updated_on';

export function plainQueryText(text: string): string {
  return text.replace(QUERY_BREAKERS, ' ').replace(/\s+/g, ' ').trim();
}

export function safeSysId(id: string): string {
  if (!SYS_ID.test(id)) throw new Error('A ServiceNow sys_id must be letters, digits, - or _.');
  return id;
}

function joined(conditions: readonly string[]): string {
  return conditions.filter((condition) => condition.length > 0).join('^');
}

const activeFor = (status: TicketStatus | undefined) =>
  status === 'done' ? 'active=false' : 'active=true';

export interface InboxQuery {
  me: string;
  groups: readonly string[];
  scope: ServiceNowInboxScope;
  status?: TicketStatus | undefined;
}

export function inboxQuery(query: InboxQuery): string {
  const active = activeFor(query.status);
  const mine = joined([active, `assigned_to=${safeSysId(query.me)}`]);
  const groups = query.groups.map(safeSysId);
  if (query.scope === 'me' || groups.length === 0) return joined([mine, NEWEST_FIRST]);
  const waiting = joined([active, `assignment_groupIN${groups.join(',')}`, 'assigned_toISEMPTY']);
  return `${mine}^NQ${joined([waiting, NEWEST_FIRST])}`;
}

const ASSIGNEE: Record<TicketAssigneeFilter, (me: string) => string> = {
  anyone: () => '',
  me: (me) => `assigned_to=${me}`,
  unassigned: () => 'assigned_toISEMPTY',
  others: (me) => `assigned_toISNOTEMPTY^assigned_to!=${me}`,
};

export interface SearchQuery {
  text: string;
  me: string;
  assignee: TicketAssigneeFilter;
  status?: TicketStatus | undefined;
}

export function searchQuery(query: SearchQuery): string {
  const text = plainQueryText(query.text);
  const number = text.toUpperCase();
  const match = isTicketKey(number, 'servicenow')
    ? `number=${number}`
    : text
      ? `short_descriptionLIKE${text}^ORdescriptionLIKE${text}`
      : '';
  return joined([
    activeFor(query.status),
    ASSIGNEE[query.assignee](safeSysId(query.me)),
    match,
    NEWEST_FIRST,
  ]);
}

export function numberQuery(number: string): string {
  const key = number.trim().toUpperCase();
  if (!isTicketKey(key, 'servicenow')) throw new Error(`${number} is not a ServiceNow number.`);
  return `number=${key}`;
}

export function groupsQuery(me: string): string {
  return `user=${safeSysId(me)}`;
}

export function choicesQuery(table: string): string {
  return `name=${table}^element=state^inactive=false^ORDERBYsequence`;
}

export function journalQuery(sysId: string): string {
  return `element_id=${safeSysId(sysId)}^elementINwork_notes,comments^ORDERBYDESCsys_created_on`;
}

export function attachmentsQuery(sysId: string): string {
  return `table_sys_id=${safeSysId(sysId)}`;
}
