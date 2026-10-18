import type { CalendarEditAction } from '@spark-outpost/contracts';
import {
  agentDetail,
  agentRemove,
  agentSave,
  type AgentCalendar,
} from '../../calendar/agent/access.ts';
import { CalendarAgentError } from '../../calendar/agent/detail.ts';
import { editRefusal, factsOf, floorReasons, sameEvent } from '../../calendar/agent/edit-rules.ts';
import { googleTarget } from '../../calendar/agent/google-client.ts';
import { savedChoices } from '../../calendar/store.ts';
import { nowOf } from '../deps.ts';
import type { SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

export const CALENDAR_CHANGED =
  'The event changed after the card was shown, so Spark changed nothing. Ask the agent to look again.';

function calendarOf(context: SparkToolContext): AgentCalendar {
  const hosts = context.deps.calendar;
  if (!hosts)
    throw new CalendarAgentError('Calendar is only available in the Spark Outpost Mac app.');
  return {
    db: context.deps.db,
    workspaceId: context.scope.workspaceId,
    host: hosts.host,
    google: hosts.google,
    now: () => nowOf(context.deps).getTime(),
  };
}

async function canEdit(calendar: AgentCalendar, calendarId: string): Promise<boolean> {
  const target = googleTarget(calendarId);
  if (!target || !calendar.google) return false;
  return (await calendar.google.account(calendar.workspaceId, target.accountId))?.canEdit ?? false;
}

function within(found: readonly string[], allowed: readonly string[]): boolean {
  return found.every((reason) => allowed.includes(reason));
}

const DONE: Record<CalendarEditAction['op'], string> = {
  create: 'Added the event to',
  update: 'Changed the event on',
  delete: 'Deleted the event from',
};

export async function performCalendarEdit(
  context: SparkToolContext,
  action: CalendarEditAction,
): Promise<Performed> {
  const calendar = calendarOf(context);
  const choice = (await savedChoices(calendar.db, calendar.workspaceId)).find(
    (candidate) => candidate.key === action.calendar.key,
  );
  if (!choice) throw new CalendarAgentError('That calendar is no longer connected.');
  const refusal = editRefusal({
    choice,
    googleCanEdit: await canEdit(calendar, choice.calendarId),
    span: action.span,
  });
  if (refusal) throw new CalendarAgentError(refusal);
  const target =
    action.eventId && action.occurrence
      ? { eventId: action.eventId, occurrence: action.occurrence }
      : null;
  let others = 0;
  if (target) {
    const current = await agentDetail(calendar, choice, target);
    if (!current || !action.before || !sameEvent(factsOf(current), action.before)) {
      throw new CalendarAgentError(CALENDAR_CHANGED);
    }
    others = current.others;
  }
  if (!within(floorReasons(action.op, choice, others), action.floor)) {
    throw new CalendarAgentError(CALENDAR_CHANGED);
  }
  if (action.op === 'delete') {
    await agentRemove(calendar, choice, target!, action.span);
    return { message: `${DONE.delete} ${choice.title}.`, url: null };
  }
  if (!action.after) throw new CalendarAgentError('The card has no event to save.');
  const after = await agentSave(calendar, {
    choice,
    target,
    fields: action.fields,
    span: action.span,
    after: action.after,
  });
  return {
    message: `${DONE[action.op]} ${choice.title}.`,
    url: null,
    output: {
      ref: { calendar: choice.key, eventId: after.event.id, occurrence: after.event.start },
    },
  };
}
