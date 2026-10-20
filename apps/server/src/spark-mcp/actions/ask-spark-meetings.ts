import {
  joinOpen,
  spanOf,
  type AskSparkAction,
  type CalendarEvent,
} from '@spark-outpost/contracts';
import { agentReadDeps } from '../../calendar/agent/access.ts';
import { announceCalendar } from '../../calendar/routes.ts';
import { calendarState } from '../../calendar/service.ts';
import { upcomingMeetings } from '../../calendar/planner.ts';
import { setMark } from '../../calendar/store.ts';
import { addIslandRequest } from '../../companion/island-requests.ts';
import { nowOf } from '../deps.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';
import { mentions } from './ask-spark-limits.ts';
import type { Performed } from './performed.ts';

export type MeetingOp = Extract<
  AskSparkAction['op'],
  'snooze_meeting' | 'dismiss_meeting' | 'join_meeting'
>;

const SNOOZE_REQUEST_MS = 2 * 60_000;
const MEETING_WORD_MIN = 2;

export const MEETING_REFUSALS = {
  off: 'Meeting actions need a connected calendar in the Mac app.',
  snooze_meeting: 'No meeting alert is showing now.',
  dismiss_meeting: 'No meeting is left today.',
  join_meeting:
    'No meeting can be joined now. Join opens 10 minutes before the start, for a Zoom, Meet, Teams or Webex link.',
  clash:
    'Meetings overlap at that time. Ask the user which one, then pass a word from its title as meeting.',
  gone: 'That meeting is gone, or it is past the time for this.',
} as const;

const MEETING_DONE: Record<MeetingOp, string> = {
  snooze_meeting: 'Spark Island snoozes the meeting alert for 1 minute.',
  dismiss_meeting: 'Dismissed the meeting’s alerts.',
  join_meeting: 'Spark Island opens the meeting’s link in your browser.',
};

export interface MeetingTimes {
  now: number;
  alertLeadMs: number;
}

function fits(op: MeetingOp, event: CalendarEvent, times: MeetingTimes): boolean {
  const span = spanOf(event);
  if (event.dismissed && op !== 'join_meeting') return false;
  if (op === 'join_meeting') return event.link !== null && joinOpen(span, times.now);
  if (op === 'snooze_meeting') {
    return times.now >= span.start - times.alertLeadMs && times.now < span.end;
  }
  return span.end > times.now;
}

function overlaps(a: CalendarEvent, b: CalendarEvent): boolean {
  const first = spanOf(a);
  const second = spanOf(b);
  return first.start < second.end && second.start < first.end;
}

export function pickMeeting(
  op: MeetingOp,
  upcoming: readonly CalendarEvent[],
  times: MeetingTimes,
  named: string | null,
): CalendarEvent | string {
  const fitting = upcoming.filter((event) => fits(op, event, times));
  const chosen = named
    ? fitting.filter((event) => mentions(event.title, named, MEETING_WORD_MIN))
    : fitting;
  const [first] = chosen.toSorted((a, b) => spanOf(a).start - spanOf(b).start);
  if (!first) return MEETING_REFUSALS[op];
  const rivals = fitting.filter((event) => event.key !== first.key && overlaps(event, first));
  const unique = named !== null && chosen.length === 1;
  return rivals.length > 0 && !unique ? MEETING_REFUSALS.clash : first;
}

async function meetingTimes(context: SparkToolContext) {
  const calendar = context.deps.calendar;
  if (!calendar) throw new SparkToolError(MEETING_REFUSALS.off);
  const now = () => nowOf(context.deps).getTime();
  const state = await calendarState(
    agentReadDeps({
      db: context.deps.db,
      workspaceId: context.scope.workspaceId,
      ...calendar,
      now,
    }),
  );
  const at = now();
  const sorted = state.events.toSorted((a, b) => spanOf(a).start - spanOf(b).start);
  return {
    upcoming: upcomingMeetings(sorted, at),
    times: { now: at, alertLeadMs: state.settings.alertLead * 60_000 },
  };
}

export async function findMeeting(
  context: SparkToolContext,
  op: MeetingOp,
  named: string | null,
): Promise<CalendarEvent> {
  const { upcoming, times } = await meetingTimes(context);
  const picked = pickMeeting(op, upcoming, times, named);
  if (typeof picked === 'string') throw new SparkToolError(picked);
  return picked;
}

async function stillFits(context: SparkToolContext, op: MeetingOp, eventKey: string) {
  const { upcoming, times } = await meetingTimes(context);
  const event = upcoming.find((candidate) => candidate.key === eventKey);
  if (!event || !fits(op, event, times)) throw new SparkToolError(MEETING_REFUSALS.gone);
  return { event, now: times.now };
}

export async function performMeeting(
  context: SparkToolContext,
  op: MeetingOp,
  action: AskSparkAction,
): Promise<Performed> {
  if (!action.meeting) throw new SparkToolError('This action is missing its meeting.');
  const { db } = context.deps;
  const { workspaceId } = context.scope;
  const { event, now } = await stillFits(context, op, action.meeting.eventKey);
  if (op === 'dismiss_meeting') {
    await setMark(db, workspaceId, {
      eventKey: event.key,
      end: event.end,
      kind: 'dismiss',
      on: true,
    });
    await announceCalendar(db);
  } else {
    const expiresAt =
      op === 'join_meeting' ? new Date(event.end) : new Date(now + SNOOZE_REQUEST_MS);
    await addIslandRequest(db, workspaceId, { kind: op, target: event.key, expiresAt });
  }
  return { message: MEETING_DONE[op], url: null, output: { eventKey: event.key } };
}
