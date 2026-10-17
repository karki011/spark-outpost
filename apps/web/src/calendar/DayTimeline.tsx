import './timeline.css';
import type { CSSProperties } from 'react';
import {
  CALENDAR_SERVICE_NAMES,
  spanOf,
  type CalendarChoice,
  type CalendarEvent,
} from '@spark-outpost/contracts';
import { clock, span as spanText } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { block, HOUR_PX, hourMarks, offset, placeEvents } from './timeline-model.ts';
import type { NoGap, TimelineSpan } from './today-model.ts';
import { CalendarName } from './CalendarName.tsx';

interface DayTimelineProps {
  span: TimelineSpan;
  events: readonly CalendarEvent[];
  free: readonly { start: number; end: number }[];
  calendars: ReadonlyMap<string, CalendarChoice>;
  gaps: readonly NoGap[];
  overlaps: ReadonlySet<string>;
  now: number | null;
  selected: string | null;
  panelId: string;
  onSelect: (key: string) => void;
}

function tags(event: CalendarEvent, calendars: ReadonlyMap<string, CalendarChoice>): string[] {
  const also = event.also
    .map((key) => calendars.get(key)?.title)
    .filter((title): title is string => Boolean(title));
  return [
    event.hold ? 'alerts held' : null,
    event.remind ? 'reminder' : null,
    also.length > 0 ? `also on ${also.join(', ')}` : null,
  ].filter((tag): tag is string => tag !== null);
}

function EventBlock(props: {
  event: CalendarEvent;
  lane: number;
  lanes: number;
  timeline: TimelineSpan;
  calendars: ReadonlyMap<string, CalendarChoice>;
  selected: boolean;
  overlap: boolean;
  panelId: string;
  onSelect: (key: string) => void;
}) {
  const { event, calendars } = props;
  const { start, end } = spanOf(event);
  const calendar = calendars.get(event.calendarKey);
  const place = block(start, end, props.timeline);
  const style = {
    ...swatch(calendar?.color ?? ''),
    top: place.top,
    height: place.height,
    left: `${(props.lane / props.lanes) * 100}%`,
    width: `calc(${100 / props.lanes}% - 4px)`,
  } as CSSProperties;
  const kind = event.focus ? 'focus' : event.busy ? 'busy' : 'free';
  const service = event.link ? ` · ${CALENDAR_SERVICE_NAMES[event.link.service]}` : '';
  const marks = tags(event, calendars);
  return (
    <button
      type="button"
      className="tl-ev"
      data-kind={kind}
      data-overlap={props.overlap || undefined}
      data-short={end - start < 30 * 60_000 || undefined}
      style={style}
      aria-expanded={props.selected}
      aria-controls={props.selected ? props.panelId : undefined}
      aria-label={`${event.title}, ${spanText(start, end)}, ${calendar?.title ?? 'Calendar'}${marks.length ? `, ${marks.join(', ')}` : ''}`}
      onClick={() => props.onSelect(event.key)}
    >
      {marks.length > 0 && (
        <span className="tl-tags" aria-hidden="true">
          {marks.map((mark) => (
            <span key={mark} className="tl-tag" data-held={mark === 'alerts held' || undefined}>
              {mark}
            </span>
          ))}
        </span>
      )}
      <b>{event.title}</b>
      <span className="tl-meta">
        {spanText(start, end)} · <CalendarName name={calendar?.title ?? 'Calendar'} />
        {service}
      </span>
    </button>
  );
}

function AllDayEvents(props: DayTimelineProps) {
  const allDay = props.events.filter((event) => event.allDay);
  if (allDay.length === 0) return null;
  return (
    <ul className="tl-allday" aria-label="All day">
      {allDay.map((event) => {
        const calendar = props.calendars.get(event.calendarKey);
        const selected = props.selected === event.key;
        return (
          <li key={event.key}>
            <button
              type="button"
              className="tl-allday-ev"
              style={swatch(calendar?.color ?? '') as CSSProperties}
              aria-expanded={selected}
              aria-controls={selected ? props.panelId : undefined}
              aria-label={`${event.title}, all day, ${calendar?.title ?? 'Calendar'}`}
              onClick={() => props.onSelect(event.key)}
            >
              {event.title}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function DayTimeline(props: DayTimelineProps) {
  return (
    <>
      <AllDayEvents {...props} />
      <TimedEvents {...props} />
    </>
  );
}

function TimedEvents(props: DayTimelineProps) {
  const { span, now } = props;
  const height = offset(span.end, span);
  return (
    <div className="tl" style={{ height }}>
      {hourMarks(span).map((at) => (
        <div key={at} className="tl-hour" style={{ top: offset(at, span) }} aria-hidden="true">
          <span>{clock(at)}</span>
        </div>
      ))}
      <div className="tl-lane">
        {props.free.map((free) => {
          const place = block(free.start, free.end, span);
          const long = free.end - free.start >= 45 * 60_000;
          return (
            <div
              key={free.start}
              className="tl-free"
              style={{ top: place.top + 2, height: Math.max(place.height - 4, HOUR_PX / 4) }}
            >
              {long ? `free ${spanText(free.start, free.end)}` : 'free'}
            </div>
          );
        })}
        {placeEvents(props.events).map(({ event, lane, lanes }) => (
          <EventBlock
            key={event.key}
            event={event}
            lane={lane}
            lanes={lanes}
            timeline={span}
            calendars={props.calendars}
            selected={props.selected === event.key}
            overlap={props.overlaps.has(event.key)}
            panelId={props.panelId}
            onSelect={props.onSelect}
          />
        ))}
        {props.gaps.map((gap) => (
          <span key={gap.at} className="tl-gap" style={{ top: offset(gap.at, span) }}>
            {gap.text}
          </span>
        ))}
      </div>
      {now !== null && now >= span.start && now <= span.end && (
        <div className="tl-now" style={{ top: offset(now, span) }} aria-hidden="true">
          <span>{clock(now)}</span>
        </div>
      )}
    </div>
  );
}
