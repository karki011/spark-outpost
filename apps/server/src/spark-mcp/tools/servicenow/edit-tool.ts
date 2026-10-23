import { z } from 'zod';
import {
  SERVICENOW_CARD_TEXT_MAX,
  SERVICENOW_TITLE_MAX,
  TICKET_COMMENT_MAX_LENGTH,
  serviceNowAnswers,
  serviceNowAsksAlways,
  serviceNowEditOpSchema,
  serviceNowLevelSchema,
  ticketKeySchemaFor,
  type ServiceNowChanges,
  type ServiceNowEditAction,
  type ServiceNowEditOp,
  type ServiceNowRecordFacts,
} from '@spark-outpost/contracts';
import { DETAIL_FIELDS, recordUrl, shownOf, valueOf } from '../../../servicenow/records.ts';
import type { Located } from '../../../servicenow/record-store.ts';
import { openServiceNow, type ServiceNowSession } from '../../../servicenow/session.ts';
import { readChoices, readStates } from '../../../servicenow/state-list.ts';
import { isClosingState } from '../../../servicenow/states.ts';
import { ACTION_NOTE } from '../../actions/action-note.ts';
import { proposeAction } from '../../actions/confirm.ts';
import { ticketDepsFor } from '../../deps.ts';
import { SparkToolError, sparkTool, type SparkToolContext } from '../../tool.ts';

type Level = z.infer<typeof serviceNowLevelSchema>;

interface EditArgs {
  action: ServiceNowEditOp;
  number: string;
  shortDescription?: string | undefined;
  description?: string | undefined;
  urgency?: Level | undefined;
  impact?: Level | undefined;
  body?: string | undefined;
  to?: string | undefined;
  closeCode?: string | undefined;
  closeNotes?: string | undefined;
}

const LEVEL_WORDS: Record<Level, string> = { '1': '1 - High', '2': '2 - Medium', '3': '3 - Low' };

function cardText(text: string): string {
  if (text.length <= SERVICENOW_CARD_TEXT_MAX) return text;
  return `${text.slice(0, SERVICENOW_CARD_TEXT_MAX - 1)}…`;
}

function factsOf(found: Located): ServiceNowRecordFacts {
  const { record } = found;
  return {
    shortDescription: shownOf(record.short_description),
    description: cardText(shownOf(record.description)),
    urgency: shownOf(record.urgency),
    impact: shownOf(record.impact),
  };
}

function changesOf(args: EditArgs): ServiceNowChanges {
  const changes: ServiceNowChanges = {};
  if (args.shortDescription !== undefined) changes.short_description = args.shortDescription;
  if (args.description !== undefined) changes.description = args.description;
  if (args.urgency !== undefined) changes.urgency = args.urgency;
  if (args.impact !== undefined) changes.impact = args.impact;
  return changes;
}

function afterOf(before: ServiceNowRecordFacts, changes: ServiceNowChanges): ServiceNowRecordFacts {
  return {
    shortDescription: changes.short_description ?? before.shortDescription,
    description:
      changes.description === undefined ? before.description : cardText(changes.description),
    urgency: changes.urgency ? LEVEL_WORDS[changes.urgency] : before.urgency,
    impact: changes.impact ? LEVEL_WORDS[changes.impact] : before.impact,
  };
}

function base(
  session: ServiceNowSession,
  op: ServiceNowEditOp,
  found: Located,
): ServiceNowEditAction {
  const { record, table } = found;
  const sysId = valueOf(record.sys_id);
  return {
    action: 'servicenow_edit',
    op,
    record: {
      table,
      number: valueOf(record.number).toUpperCase(),
      sysId,
      title: shownOf(record.short_description),
      url: recordUrl(session.instanceUrl, table, sysId),
      caller: shownOf(record.caller_id) || shownOf(record.opened_by) || null,
    },
    updated: valueOf(record.sys_updated_on),
    changes: {},
    before: null,
    after: null,
    note: null,
    move: null,
  };
}

async function closeCodeFor(
  session: ServiceNowSession,
  found: Located,
  closeCode: string | undefined,
) {
  if (found.table !== 'incident') {
    if (closeCode) throw new SparkToolError('closeCode is for incidents only. Leave it out.');
    return null;
  }
  const codes = await readChoices(session.store.client, 'incident', 'close_code');
  if (codes.length === 0) return closeCode ?? null;
  const named = codes.map((code) =>
    code.label === code.value ? code.value : `${code.label} (${code.value})`,
  );
  if (!closeCode) {
    throw new SparkToolError(`Pass closeCode, one of: ${named.join(', ')}.`);
  }
  const match = codes.find(
    (code) =>
      code.value.toLowerCase() === closeCode.toLowerCase() ||
      code.label.toLowerCase() === closeCode.toLowerCase(),
  );
  if (!match)
    throw new SparkToolError(
      `${closeCode} is not a close code here. Use one of: ${named.join(', ')}.`,
    );
  return match.value;
}

async function moveOf(session: ServiceNowSession, found: Located, args: EditArgs) {
  if (!args.to) throw new SparkToolError('Pass to with the state name to move to.');
  const states = await readStates(session.store.client, found.table);
  const wanted = args.to.trim().toLowerCase();
  const next = states.find((state) => state.name.toLowerCase() === wanted);
  if (!next) {
    throw new SparkToolError(
      `${args.to} is not a state here. Use one of: ${states.map((state) => state.name).join(', ')}.`,
    );
  }
  const from = shownOf(found.record.state);
  if (valueOf(found.record.state) === next.value) {
    throw new SparkToolError(`${valueOf(found.record.number)} is already ${from}.`);
  }
  const final = isClosingState(found.table, next);
  if (final && !args.closeNotes) {
    throw new SparkToolError('Pass closeNotes: the caller usually sees them.');
  }
  return {
    from,
    to: next.name,
    value: next.value,
    final,
    closeCode: final ? await closeCodeFor(session, found, args.closeCode) : null,
    closeNotes: final ? (args.closeNotes ?? null) : null,
  };
}

async function plan(session: ServiceNowSession, args: EditArgs): Promise<ServiceNowEditAction> {
  const found = await session.store.writable(args.number, DETAIL_FIELDS);
  const action = base(session, args.action, found);
  if (args.action === 'update') {
    const changes = changesOf(args);
    if (Object.keys(changes).length === 0) {
      throw new SparkToolError(
        'Pass at least one of shortDescription, description, urgency or impact.',
      );
    }
    const before = factsOf(found);
    return { ...action, changes, before, after: afterOf(before, changes) };
  }
  if (args.action === 'move') return { ...action, move: await moveOf(session, found, args) };
  if (!args.body) throw new SparkToolError('Pass body with the note text.');
  return { ...action, note: args.body };
}

async function edit(context: SparkToolContext, args: EditArgs) {
  const session = await openServiceNow(ticketDepsFor(context.deps, context.scope));
  const action = await plan(session, args);
  const answers = serviceNowAnswers(action);
  return proposeAction(context, action, {
    alwaysAsk: serviceNowAsksAlways(action),
    confirmName: answers.confirm,
    declineName: answers.decline,
  });
}

export const serviceNowEditTool = sparkTool({
  name: 'spark_servicenow_edit',
  needs: 'servicenow',
  acts: true,
  title: 'Change ServiceNow',
  description: `Changes a ServiceNow record by number: update sets shortDescription, description, urgency or impact (1 high to 3 low; the instance derives priority); work_note adds an internal work note (body); comment adds an additional comment the caller sees (body), which asks the user in every mode; move sets the state by name (to), and resolving, closing or cancelling needs closeNotes (and closeCode on incidents) and asks in every mode. Change requests are read only; nothing is created or deleted. The card shows before and after and Spark checks the record again before writing. ${ACTION_NOTE}`,
  input: {
    action: serviceNowEditOpSchema,
    number: ticketKeySchemaFor('servicenow'),
    shortDescription: z.string().trim().min(1).max(SERVICENOW_TITLE_MAX).optional(),
    description: z.string().max(TICKET_COMMENT_MAX_LENGTH).optional(),
    urgency: serviceNowLevelSchema.optional(),
    impact: serviceNowLevelSchema.optional(),
    body: z.string().trim().min(1).max(TICKET_COMMENT_MAX_LENGTH).optional(),
    to: z.string().trim().min(1).max(100).optional(),
    closeCode: z.string().trim().min(1).max(100).optional(),
    closeNotes: z.string().trim().min(1).max(TICKET_COMMENT_MAX_LENGTH).optional(),
  },
  run: (args, context) => edit(context, args),
});
