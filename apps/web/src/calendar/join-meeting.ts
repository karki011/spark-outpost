import { MEETING_TITLE_MAX, type CalendarEvent } from '@spark-outpost/contracts';
import { meetingsApi } from '../meetings/index.ts';
import { openJoin } from './today-model.ts';
import { openTodayMeeting } from './today-request.ts';

export function joinMeeting(event: CalendarEvent, calendarName?: string): void {
  if (!event.link) return;
  openJoin(event.link.url);
  const title = event.title.trim().slice(0, MEETING_TITLE_MAX);
  void meetingsApi
    .joinNotes({
      eventKey: event.key,
      ...(title ? { title } : {}),
      ...(calendarName ? { calendarName } : {}),
    })
    .then(({ detail }) => {
      if (detail) openTodayMeeting(detail.meeting.id);
    })
    .catch(() => undefined);
}
