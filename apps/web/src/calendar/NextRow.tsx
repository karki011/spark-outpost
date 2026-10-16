import {
  CALENDAR_SERVICE_NAMES,
  spanOf,
  type CalendarChoice,
  type CalendarEvent,
} from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';
import { clock, span } from './calendar-format.ts';
import { countdown, upcomingMeetings } from './today-model.ts';

interface NextRowProps {
  events: readonly CalendarEvent[];
  calendars: ReadonlyMap<string, CalendarChoice>;
  isToday: boolean;
  now: number;
  count: number;
}

export function NextRow({ events, calendars, isToday, now, count }: NextRowProps) {
  if (!isToday) {
    return (
      <div className="td-next">
        <span className="td-what">
          {countLabel(count, 'event')}
          <small>Join and the now line appear on the day</small>
        </span>
      </div>
    );
  }
  const next = upcomingMeetings(events, now)[0];
  if (!next) {
    return (
      <div className="td-next" aria-live="polite">
        <span className="td-big">—</span>
        <span className="td-what">
          No more meetings
          <small>Nothing left to nudge for today</small>
        </span>
      </div>
    );
  }
  const { start, end } = spanOf(next);
  const calendar = calendars.get(next.calendarKey)?.title ?? 'Calendar';
  const started = start <= now;
  const service = next.link ? ` · ${CALENDAR_SERVICE_NAMES[next.link.service]}` : '';
  return (
    <div className="td-next" aria-live="polite">
      <span className="td-big">{countdown(next, now)}</span>
      <span className="td-what">
        {next.title}
        <small>
          {started ? `until ${clock(end)}` : span(start, end)} · {calendar}
          {service}
        </small>
      </span>
    </div>
  );
}
