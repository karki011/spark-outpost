import {
  MEETING_TITLE_MAX,
  type CalendarEvent,
  type MeetingJoinNotes,
} from '@spark-outpost/contracts';
import { meetingsApi } from '../meetings/index.ts';
import { openJoin } from './today-model.ts';
import { openTodayMeeting } from './today-request.ts';

const CALENDAR_NAME_MAX = 200;

type ProblemListener = (problem: string) => void;
const problemListeners = new Set<ProblemListener>();

export function onNotesProblem(listener: ProblemListener): () => void {
  problemListeners.add(listener);
  return () => problemListeners.delete(listener);
}

const NOTES_UNREACHABLE: MeetingJoinNotes = {
  detail: null,
  problem: 'Spark could not be reached. Try Take notes.',
};

export function notesProblemText(problem: string): string {
  return `Notes didn’t start: ${problem}`;
}

export function startJoinNotes(
  event: CalendarEvent,
  calendarName?: string,
): Promise<MeetingJoinNotes> {
  const title = event.title.trim().slice(0, MEETING_TITLE_MAX);
  const calendar = calendarName?.trim().slice(0, CALENDAR_NAME_MAX);
  return meetingsApi
    .joinNotes({
      eventKey: event.key,
      ...(title ? { title } : {}),
      ...(calendar ? { calendarName: calendar } : {}),
    })
    .catch(() => NOTES_UNREACHABLE);
}

export function joinMeeting(event: CalendarEvent, calendarName?: string): void {
  if (!event.link) return;
  openJoin(event.link.url);
  void startJoinNotes(event, calendarName).then(({ detail, problem }) => {
    if (detail) openTodayMeeting(detail.meeting.id);
    if (problem) problemListeners.forEach((listener) => listener(problem));
  });
}
