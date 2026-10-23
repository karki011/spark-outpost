import type { ServiceNowEditAction } from '@spark-outpost/contracts';
import { valueOf } from '../../servicenow/records.ts';
import { openServiceNow } from '../../servicenow/session.ts';
import { ticketDepsFor } from '../deps.ts';
import type { SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

export const SERVICENOW_CHANGED =
  'The record changed in ServiceNow after the card was shown, so Spark changed nothing. Ask the agent to read it again.';

const CHECK_FIELDS = ['sys_id', 'number', 'sys_updated_on'];

const FIELD_WORDS: Record<string, string> = {
  short_description: 'short description',
  description: 'description',
  urgency: 'urgency',
  impact: 'impact',
};

function bodyOf(action: ServiceNowEditAction): Record<string, string> {
  if (action.op === 'update') {
    return Object.fromEntries(
      Object.entries(action.changes).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
  }
  if (action.op === 'work_note') return { work_notes: action.note ?? '' };
  if (action.op === 'comment') return { comments: action.note ?? '' };
  const move = action.move!;
  return {
    state: move.value,
    ...(move.final && move.closeNotes ? { close_notes: move.closeNotes } : {}),
    ...(move.final && move.closeCode ? { close_code: move.closeCode } : {}),
  };
}

function doneLine(action: ServiceNowEditAction): string {
  const number = action.record.number;
  if (action.op === 'update') {
    const fields = Object.keys(action.changes).map((field) => FIELD_WORDS[field] ?? field);
    return `Changed ${fields.join(', ')} on ${number}.`;
  }
  if (action.op === 'work_note') return `Added a work note to ${number}.`;
  if (action.op === 'comment') return `Posted a comment the caller sees on ${number}.`;
  const move = action.move!;
  if (move.final) return `${number} is ${move.to} now.`;
  return `Moved ${number} to ${move.to}.`;
}

export async function performServiceNowEdit(
  context: SparkToolContext,
  action: ServiceNowEditAction,
): Promise<Performed> {
  const { store } = await openServiceNow(ticketDepsFor(context.deps, context.scope));
  const { record } = action;
  const now = await store.writable(record.number, CHECK_FIELDS);
  const sameRecord = now.table === record.table && valueOf(now.record.sys_id) === record.sysId;
  const appends = action.op === 'work_note' || action.op === 'comment';
  const movedOn = !appends && valueOf(now.record.sys_updated_on) !== action.updated;
  if (!sameRecord || movedOn) {
    throw new Error(SERVICENOW_CHANGED);
  }
  await store.patch(
    { table: record.table, sysId: record.sysId },
    bodyOf(action),
    `changing ${record.number}`,
  );
  return { message: doneLine(action), url: record.url, output: { number: record.number } };
}
