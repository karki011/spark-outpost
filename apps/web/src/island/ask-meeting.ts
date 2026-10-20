import type { CalendarEvent } from '@spark-outpost/contracts';
import { countdown, nextMeeting } from '../calendar/today-model.ts';

export const NEXT_MEETING_QUESTION = 'Next meeting?';

const ASKS_NEXT_MEETING = /\b(next|upcoming)\s+(meeting|call)s?\b/i;

export function meetingAnswer(
  question: string,
  upcoming: readonly CalendarEvent[] | null,
  now: number,
): string | null {
  if (!upcoming || !ASKS_NEXT_MEETING.test(question)) return null;
  const next = nextMeeting(upcoming, now);
  if (!next) return 'No meetings coming up.';
  return `Your next meeting is “${next.title}” ${countdown(next, now)}.`;
}
