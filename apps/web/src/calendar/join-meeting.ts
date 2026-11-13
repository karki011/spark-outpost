import { MEETING_TITLE_MAX, type CalendarEvent } from '@spark-outpost/contracts';
import { meetingsApi } from '../meetings/index.ts';
import { openJoin } from './today-model.ts';
import { openTodayMeeting } from './today-request.ts';

const CALENDAR_NAME_MAX = 200;

export function joinMeeting(event: CalendarEvent, calendarName?: string): void {
  if (!event.link) return;
  openJoin(event.link.url);
  const title = event.title.trim().slice(0, MEETING_TITLE_MAX);
  const calendar = calendarName?.trim().slice(0, CALENDAR_NAME_MAX);
  void meetingsApi
    .joinNotes({
      eventKey: event.key,
      ...(title ? { title } : {}),
      ...(calendar ? { calendarName: calendar } : {}),
    })
    .then(({ detail }) => {
      if (detail) openTodayMeeting(detail.meeting.id);
    })
    .catch(() => undefined);
}
