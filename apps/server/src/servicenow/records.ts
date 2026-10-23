import { z } from 'zod';
import {
  serviceNowTableSchema,
  type ServiceNowTable,
  type TicketSummary,
} from '@spark-outpost/contracts';
import type { MoveSettings } from '../tickets/move-target.ts';
import { serviceNowStatus } from './states.ts';

const field = z
  .object({
    value: z.string().nullable().catch(null),
    display_value: z.string().nullable().catch(null),
  })
  .nullable()
  .optional()
  .catch(null);

export type Field = z.infer<typeof field>;

export const RECORD_FIELDS = [
  'sys_id',
  'number',
  'short_description',
  'state',
  'priority',
  'assignment_group',
  'assigned_to',
  'caller_id',
  'opened_by',
  'sys_updated_on',
  'sys_created_on',
  'sys_class_name',
  'due_date',
  'closed_at',
];

export const DETAIL_FIELDS = [...RECORD_FIELDS, 'description', 'impact', 'urgency', 'category'];

export const recordSchema = z.object({
  sys_id: field,
  number: field,
  short_description: field,
  description: field,
  state: field,
  priority: field,
  impact: field,
  urgency: field,
  category: field,
  assignment_group: field,
  assigned_to: field,
  caller_id: field,
  opened_by: field,
  sys_updated_on: field,
  sys_created_on: field,
  sys_class_name: field,
  due_date: field,
  closed_at: field,
});
export type ServiceNowRecord = z.infer<typeof recordSchema>;

export const recordsSchema = z.object({ result: z.array(recordSchema) });

export const valueOf = (entry: Field): string => entry?.value ?? '';
export const shownOf = (entry: Field): string => entry?.display_value ?? entry?.value ?? '';

const STORED_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

export function isoTime(stored: string): string | null {
  const match = STORED_TIME.exec(stored.trim());
  return match ? `${match[1]}T${match[2]}Z` : null;
}

function dateOnly(stored: string): string | null {
  const iso = isoTime(stored);
  return iso ? iso.slice(0, 10) : null;
}

export function priorityRankOf(value: string): number {
  const rank = Number(value);
  return Number.isInteger(rank) && rank >= 1 && rank <= 4 ? rank : 0;
}

export function tableOf(record: ServiceNowRecord, fallback: ServiceNowTable): ServiceNowTable {
  const parsed = serviceNowTableSchema.safeParse(valueOf(record.sys_class_name));
  return parsed.success ? parsed.data : fallback;
}

export function recordUrl(instanceUrl: string, table: string, sysId: string): string {
  const target = `${table}.do?sys_id=${sysId}`;
  return `${instanceUrl}/nav_to.do?uri=${encodeURIComponent(target)}`;
}

function person(entry: Field): { id: string; name: string } | null {
  const id = valueOf(entry);
  return id ? { id, name: shownOf(entry) || id } : null;
}

export interface SummaryContext {
  instanceUrl: string;
  table: ServiceNowTable;
  settings: MoveSettings;
}

export function summaryOf(record: ServiceNowRecord, context: SummaryContext): TicketSummary {
  const table = tableOf(record, context.table);
  const sysId = valueOf(record.sys_id);
  const stateName = shownOf(record.state);
  const caller = shownOf(record.caller_id) || shownOf(record.opened_by);
  const updatedAt = isoTime(valueOf(record.sys_updated_on)) ?? new Date(0).toISOString();
  const status = serviceNowStatus(stateName, context.settings);
  return {
    source: 'servicenow',
    key: valueOf(record.number).toUpperCase(),
    title: shownOf(record.short_description),
    status,
    statusName: stateName,
    url: recordUrl(context.instanceUrl, table, sysId),
    updatedAt,
    project: table,
    priority: shownOf(record.priority) || null,
    sprint: null,
    priorityRank: priorityRankOf(valueOf(record.priority)),
    assignedTo: person(record.assigned_to),
    labels: [],
    dueDate: dateOnly(valueOf(record.due_date)),
    doneAt: status === 'done' ? isoTime(valueOf(record.closed_at)) : null,
    reporter: caller ? { name: caller } : null,
    createdAt: isoTime(valueOf(record.sys_created_on)),
    group: shownOf(record.assignment_group) || null,
  };
}
