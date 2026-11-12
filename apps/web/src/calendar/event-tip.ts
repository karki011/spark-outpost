import { spanOf, type CalendarChoice, type CalendarEvent } from '@spark-outpost/contracts';
import { span } from './calendar-format.ts';
import { replyState } from './reply-status.ts';

export function eventTip(event: CalendarEvent, calendar: CalendarChoice | undefined): string {
  const { start, end } = spanOf(event);
  return [
    event.title,
    event.allDay ? 'All day' : span(start, end),
    calendar?.title,
    replyState(event.myStatus).word,
  ]
    .filter(Boolean)
    .join(' · ');
}
