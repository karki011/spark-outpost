import { z } from 'zod';
import {
  CALENDAR_ALARM_MAX_MINUTES,
  calendarEditConfirm,
  calendarEditSpanSchema,
  type CalendarChoice,
  type CalendarEditAction,
  type CalendarEditOp,
  type CalendarEventFacts,
  type CalendarEventFields,
} from '@spark-outpost/contracts';
import { agentDetail, type AgentCalendar } from '../../../calendar/agent/access.ts';
import {
  completeFields,
  editRefusal,
  factsAfter,
  factsOf,
  floorReasons,
  isSynced,
  newEventProblem,
  timesProblem,
} from '../../../calendar/agent/edit-rules.ts';
import { googleTarget } from '../../../calendar/agent/google-client.ts';
import { proposeAction } from '../../actions/confirm.ts';
import { sparkTool, type SparkToolContext } from '../../tool.ts';
import {
  CalendarToolError,
  asToolErrors,
  auditCalendar,
  auditFailures,
  calendarSession,
  choiceByKey,
} from './context.ts';
import { parseWhen } from './read-model.ts';

const TOOL = 'spark_calendar_edit';

const editOpSchema = z.enum(['create', 'update', 'delete']);

interface EditArgs {
  action: CalendarEditOp;
  calendar: string;
  eventId?: string | undefined;
  occurrence?: string | undefined;
  span: 'this' | 'future';
  title?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
  allDay?: boolean | undefined;
  notes?: string | undefined;
  location?: string | undefined;
  alarmMinutes?: number | null | undefined;
}

function iso(text: string | undefined, name: string): string | undefined {
  return text === undefined ? undefined : new Date(parseWhen(text, name)).toISOString();
}

function requestedFields(args: EditArgs): CalendarEventFields {
  const fields: CalendarEventFields = {
    title: args.title?.trim(),
    start: iso(args.start, 'start'),
    end: iso(args.end, 'end'),
    allDay: args.allDay,
    notes: args.notes,
    location: args.location,
    alarmMinutes: args.alarmMinutes,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as CalendarEventFields;
}

async function googleCanEdit(calendar: AgentCalendar, choice: CalendarChoice): Promise<boolean> {
  const target = googleTarget(choice.calendarId);
  if (!target || !calendar.google) return false;
  return (await calendar.google.account(calendar.workspaceId, target.accountId))?.canEdit ?? false;
}

async function before(
  calendar: AgentCalendar,
  choice: CalendarChoice,
  args: EditArgs,
): Promise<CalendarEventFacts | null> {
  if (args.action === 'create') return null;
  if (!args.eventId || !args.occurrence) {
    throw new CalendarToolError(
      'invalid_input',
      'Pass eventId and occurrence from the event’s ref (spark_calendar).',
    );
  }
  const found = await agentDetail(calendar, choice, {
    eventId: args.eventId,
    occurrence: iso(args.occurrence, 'occurrence')!,
  });
  if (!found) {
    throw new CalendarToolError(
      'not_found',
      'That event is gone or moved. Read the calendar again.',
    );
  }
  return factsOf(found);
}

function checked(
  op: CalendarEditOp,
  prior: CalendarEventFacts | null,
  fields: CalendarEventFields,
) {
  if (op === 'delete') return null;
  const problem =
    op === 'create'
      ? newEventProblem(fields)
      : Object.keys(fields).length === 0
        ? 'Pass at least one field to change.'
        : null;
  if (problem) throw new CalendarToolError('invalid_input', problem);
  const after = factsAfter(prior, fields);
  const times = timesProblem(after);
  if (times) throw new CalendarToolError('invalid_input', times);
  return after;
}

async function plan(calendar: AgentCalendar, args: EditArgs): Promise<CalendarEditAction> {
  const choice = await choiceByKey(calendar, args.calendar);
  const refusal = editRefusal({
    choice,
    googleCanEdit: await googleCanEdit(calendar, choice),
    span: args.span,
  });
  if (refusal) throw new CalendarToolError('refused', refusal);
  const prior = await asToolErrors(() => before(calendar, choice, args));
  const fields = args.action === 'delete' ? {} : completeFields(requestedFields(args), prior);
  const after = checked(args.action, prior, fields);
  return {
    action: 'calendar_edit',
    op: args.action,
    calendar: {
      key: choice.key,
      title: choice.title,
      account: choice.sourceTitle,
      synced: isSynced(choice),
    },
    eventId: args.action === 'create' ? null : args.eventId!,
    occurrence: prior?.start ?? null,
    span: prior?.recurring ? args.span : 'this',
    fields,
    before: prior,
    after,
    floor: floorReasons(args.action, choice, prior?.others ?? 0),
  };
}

async function edit(args: EditArgs, context: SparkToolContext) {
  const calendar = await calendarSession(context);
  const action = await plan(calendar, args);
  const result = await proposeAction(context, action, {
    alwaysAsk: action.floor.length > 0,
    sendsTo: action.calendar.synced ? `to the calendar ${action.calendar.title}` : null,
    sendSubject: `a change on ${action.calendar.title}`,
    confirmName: calendarEditConfirm(action),
  });
  auditCalendar(context, {
    tool: TOOL,
    action: args.action,
    decision: result.outcome === 'waiting_for_user' ? 'waiting_for_user' : 'mode',
    detail: {
      calendarKey: action.calendar.key,
      synced: action.calendar.synced,
      changed: Object.keys(action.fields).toSorted(),
      ...(action.floor.length > 0 ? { floor: action.floor } : {}),
      ...('approvalId' in result && result.approvalId ? { approvalId: result.approvalId } : {}),
    },
  });
  return result;
}

export const calendarEditTool = sparkTool({
  name: TOOL,
  needs: 'calendar_edit',
  acts: true,
  title: 'Change the calendar',
  description:
    'Creates, changes (title, start, end, allDay, notes, location, alarmMinutes; null removes the alarm) or deletes an event on a calendar where the user turned on Agents can edit. calendar is the calendar key; update and delete take eventId and occurrence from the event’s ref. span future changes a recurring macOS event from this occurrence on. Follows the agent mode with a card showing the change before and after; a delete, an event with other people, and a shared calendar always ask. Never invites anyone or answers invitations.',
  input: {
    action: editOpSchema,
    calendar: z.uuid(),
    eventId: z.string().max(500).optional(),
    occurrence: z.string().max(40).optional(),
    span: calendarEditSpanSchema.default('this'),
    title: z.string().max(1_000).optional(),
    start: z.string().max(40).optional(),
    end: z.string().max(40).optional(),
    allDay: z.boolean().optional(),
    notes: z.string().max(20_000).optional(),
    location: z.string().max(2_000).optional(),
    alarmMinutes: z.number().int().min(0).max(CALENDAR_ALARM_MAX_MINUTES).nullable().optional(),
  },
  run: (args, context) =>
    auditFailures(context, { tool: TOOL, action: args.action }, () => edit(args, context)),
});
