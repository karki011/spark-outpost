import { clock } from '../calendar/calendar-format.ts';
import { meetingDurationMs, type Meeting, type MeetingNotesState } from '@spark-outpost/contracts';

export const NOTES_STATE_WORDS: Record<MeetingNotesState, string> = {
  none: 'No notes',
  writing: 'Writing notes…',
  ready: 'Notes',
  failed: 'Notes failed',
};

export function formatLength(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'Under 1 min';
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

export function formatStarted(iso: string, now: number = Date.now()): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${day}, ${clock(date.getTime())}`;
}

export function sourceLabel(meeting: Pick<Meeting, 'source' | 'calendarName'>): string {
  if (meeting.source === 'adhoc') return 'Started by you';
  return meeting.calendarName ?? 'Calendar';
}

export function lengthLabel(meeting: Pick<Meeting, 'startedAt' | 'endedAt'>): string {
  return formatLength(meetingDurationMs(meeting, Date.now()));
}

export function formatOffset(ms: number): string {
  const total = Math.floor(ms / 1000);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}
