import { joinLink, type CalendarEditAction } from '@spark-outpost/contracts';
import {
  agentDetail,
  agentRemove,
  agentReply,
  agentSave,
  cloudCanEdit,
  type AgentCalendar,
} from '../../calendar/agent/access.ts';
import { CalendarAgentError } from '../../calendar/agent/detail.ts';
import {
  editRefusal,
  factsOf,
  floorReasons,
  googleOnlyProblem,
  othersRefusal,
  sameEvent,
} from '../../calendar/agent/edit-rules.ts';
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
    microsoft: hosts.microsoft ?? null,
    now: () => nowOf(context.deps).getTime(),
  };
}

function within(found: readonly string[], allowed: readonly string[]): boolean {
  return found.every((reason) => allowed.includes(reason));
}

const DELETE_KEPT: Record<string, string> = {
  google: ' Google keeps deleted events in its trash.',
  microsoft: ' Outlook keeps it in Deleted Items.',
};

const DONE = { create: 'Added the event to', update: 'Changed the event on' };

const REPLIED: Record<NonNullable<CalendarEditAction['reply']>, string> = {
  accepted: 'Answered Yes to',
  tentative: 'Answered Maybe to',
  declined: 'Answered No to',
};

function createdNote(action: CalendarEditAction): string {
  const count = action.guests.length;
  const invited = count > 0 ? ` and invited ${count} ${count === 1 ? 'guest' : 'guests'}` : '';
  return `${invited}${action.meet ? ', with a Google Meet link' : ''}`;
}

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
    cloudCanEdit: await cloudCanEdit(calendar, choice.calendarId),
    span: action.span,
  });
  if (refusal) throw new CalendarAgentError(refusal);
  const unfit = googleOnlyProblem({
    op: action.op,
    choice,
    guests: action.guests.length,
    meet: action.meet,
  });
  if (unfit) throw new CalendarAgentError(unfit);
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
    const crowded = othersRefusal(choice, others);
    if (crowded) throw new CalendarAgentError(crowded);
  }
  if (!within(floorReasons(action.op, choice, others, action.guests.length), action.floor)) {
    throw new CalendarAgentError(CALENDAR_CHANGED);
  }
  if (action.op === 'reply') {
    if (!target || !action.reply) throw new CalendarAgentError('The card has no reply to send.');
    await agentReply(calendar, choice, target, action.reply);
    const title = action.before?.title || 'the event';
    return { message: `${REPLIED[action.reply]} ${title}. Google told the organiser.`, url: null };
  }
  if (action.op === 'delete') {
    await agentRemove(calendar, choice, target!, action.span);
    const title = action.before?.title || 'the event';
    const kept = DELETE_KEPT[choice.sourceKind] ?? '';
    return { message: `Deleted ${title} from ${choice.title}.${kept}`, url: null };
  }
  if (!action.after) throw new CalendarAgentError('The card has no event to save.');
  const after = await agentSave(calendar, {
    choice,
    target,
    fields: action.fields,
    span: action.span,
    after: action.after,
    guests: action.guests,
    meet: action.meet,
  });
  const join = joinLink(after.event);
  return {
    message: `${DONE[action.op]} ${choice.title}${createdNote(action)}.`,
    url: null,
    output: {
      ref: { calendar: choice.key, eventId: after.event.id, occurrence: after.event.start },
      ...(join ? { joinLink: join.url } : {}),
    },
  };
}
