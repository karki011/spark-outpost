import './upcoming.css';
import { useMemo } from 'react';
import {
  isMeeting,
  localDayStart,
  longestFree,
  spanOf,
  workWindow,
} from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { duration, span } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { DayShapeBar } from './DayShapeBar.tsx';
import { localDate, useCalendarDay, useCalendarState } from './use-calendar.ts';
import { CalendarName } from './CalendarName.tsx';
import { calendarMap } from './today-model.ts';

export function CalendarBriefBlock({ now }: { now: number }) {
  const { remote } = useRemoteClient();
  const { state, status } = useCalendarState();
  const on = !remote && state === 'ready' && status?.settings.briefBlock === true;
  const date = localDate(now);
  const query = useCalendarDay(date, on);
  const day = query.data?.date === date ? query.data : null;
  const calendars = useMemo(() => calendarMap(day?.calendars), [day]);
  if (!on || !day) return null;
  const meetings = day.events.filter(isMeeting);
  const longest = longestFree(day.free);
  const focus = day.events.find((event) => event.focus && !event.allDay);
  const holds = status?.settings.holdRule !== 'never';
  const work = workWindow(localDayStart(now));
  const hours = span(work.start, work.end);
  return (
    <section className="cal-brief" aria-labelledby="cal-brief-h">
      <p className="cal-brief-note">From your calendar · on this Mac, not sent to a model</p>
      <h3 id="cal-brief-h">Today’s meetings</h3>
      {meetings.length === 0 ? (
        <p className="cal-brief-line">No meetings today.</p>
      ) : (
        <ul className="cal-brief-list">
          {meetings.map((event) => {
            const { start, end } = spanOf(event);
            const calendar = calendars.get(event.calendarKey);
            return (
              <li key={event.key}>
                <time>{span(start, end)}</time>
                <span>{event.title}</span>
                {calendar && (
                  <span className="cal-chip">
                    <i className="cal-sw" style={swatch(calendar.color)} aria-hidden="true" />
                    <CalendarName name={calendar.title} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <h3>Free blocks</h3>
      <DayShapeBar
        shape={day.shape}
        dayStart={localDayStart(now)}
        label={`Busy and focus time, ${hours}`}
      />
      <p className="cal-brief-line">
        {longest ? (
          <>
            Longest free block, {hours}: <b>{span(longest.start, longest.end)}</b> (
            {duration(Math.round((longest.end - longest.start) / 60_000))}).
          </>
        ) : (
          `No free block of 30 min or more, ${hours}.`
        )}
        {focus && holds && (
          <>
            {' '}
            <b>{span(spanOf(focus).start, spanOf(focus).end)}</b> is a focus block: chimes will be
            held.
          </>
        )}
      </p>
    </section>
  );
}
