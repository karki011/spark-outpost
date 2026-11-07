import './upcoming.css';
import {
  isMeeting,
  localDayStart,
  longestFree,
  spanOf,
  workWindow,
} from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { duration, span } from './calendar-format.ts';
import { DayShapeBar } from './DayShapeBar.tsx';
import { openTodayDay } from './today-request.ts';
import { localDate, useCalendarDay, useCalendarState } from './use-calendar.ts';

export function CalendarBriefBlock({ now }: { now: number }) {
  const { remote } = useRemoteClient();
  const { state, status } = useCalendarState();
  const on = !remote && state === 'ready' && status?.settings.briefBlock === true;
  const date = localDate(now);
  const query = useCalendarDay(date, on);
  const day = query.data?.date === date ? query.data : null;
  if (!on || !day) return null;
  const longest = longestFree(day.free);
  const focus = day.events.find((event) => event.focus && !event.allDay);
  const meetings = day.events.filter(isMeeting);
  const holds = status?.settings.holdRule !== 'never';
  const work = workWindow(localDayStart(now));
  const hours = span(work.start, work.end);
  return (
    <section className="cal-brief" aria-labelledby="cal-brief-h">
      <p className="cal-brief-note">From your calendar · on this Mac, not sent to a model</p>
      <h3 id="cal-brief-h">Free time today</h3>
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
      {meetings[0] && (
        <p className="cal-brief-line">
          {meetings.length === 1 ? '1 meeting today.' : `${meetings.length} meetings today.`}{' '}
          <button type="button" className="hlink cal-brief-all" onClick={openTodayDay}>
            See all in Today
          </button>
        </p>
      )}
    </section>
  );
}
