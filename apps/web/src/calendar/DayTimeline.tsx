import './timeline.css';
import type { CSSProperties } from 'react';
import {
  CALENDAR_SERVICE_NAMES,
  clashText,
  spanOf,
  type CalendarChoice,
  type CalendarEvent,
} from '@spark-outpost/contracts';
import { WarnIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { hasEnded } from './event-clock.ts';
import { eventTip } from './event-tip.ts';
import { replyState } from './reply-status.ts';
import { clock, duration, hourMark, span as spanText } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { block, blockRows, HOUR_PX, hourMarks, offset, placeEvents } from './timeline-model.ts';
import type { NoGap, TimelineSpan } from './today-model.ts';
import { CalendarName } from './CalendarName.tsx';

const NO_CLASHES: readonly string[] = [];
const NARROW_SHARE = 0.34;

interface DayTimelineProps {
  span: TimelineSpan;
  events: readonly CalendarEvent[];
  free: readonly { start: number; end: number }[];
  calendars: ReadonlyMap<string, CalendarChoice>;
  gaps: readonly NoGap[];
  overlaps: ReadonlySet<string>;
  clashes: ReadonlyMap<string, readonly string[]>;
  now: number | null;
  clock: number;
  selected: string | null;
  panelId: string;
  onSelect: (key: string) => void;
}

function tags(
  event: CalendarEvent,
  calendars: ReadonlyMap<string, CalendarChoice>,
  clashes: readonly string[],
): string[] {
  const also = event.also
    .map((key) => calendars.get(key)?.title)
    .filter((title): title is string => Boolean(title));
  return [
    clashText(clashes),
    event.hold ? 'alerts held' : null,
    event.remind ? 'reminder' : null,
    also.length > 0 ? `also on ${also.join(', ')}` : null,
  ].filter((tag): tag is string => tag !== null);
}

function EventBlock(props: {
  event: CalendarEvent;
  lane: number;
  lanes: number;
  span: number;
  ended: boolean;
  timeline: TimelineSpan;
  calendars: ReadonlyMap<string, CalendarChoice>;
  clashes: readonly string[];
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
    width: `calc(${(props.span / props.lanes) * 100}% - 4px)`,
  } as CSSProperties;
  const kind = event.focus ? 'focus' : event.busy ? 'busy' : 'free';
  const service = event.link ? ` · ${CALENDAR_SERVICE_NAMES[event.link.service]}` : '';
  const marks = tags(event, calendars, props.clashes);
  const clash = clashText(props.clashes);
  const { rows, titleLines } = blockRows(place.height);
  const narrow = props.span / props.lanes < NARROW_SHARE;
  const showTags = rows === 3 && !narrow && marks.length > 0;
  const clashIcon = Boolean(clash) && !showTags;
  const reply = replyState(event.myStatus);
  const tip = useTooltip(eventTip(event, calendar));
  return (
    <>
      <button
        {...tip.triggerProps}
        type="button"
        className="tl-ev"
        data-event-key={event.key}
        data-ended={props.ended || undefined}
        data-kind={kind}
        data-reply={reply.look}
        data-overlap={props.overlap || undefined}
        data-rows={rows}
        data-clash={clashIcon || undefined}
        style={{ ...style, '--tl-title-lines': titleLines } as CSSProperties}
        aria-expanded={props.selected}
        aria-controls={props.selected ? props.panelId : undefined}
        aria-label={`${event.title}, ${spanText(start, end)}, ${calendar?.title ?? 'Calendar'}${marks.length ? `, ${marks.join(', ')}` : ''}${reply.word ? `, ${reply.word}` : ''}`}
        onClick={() => props.onSelect(event.key)}
      >
        {rows === 1 ? (
          <span className="tl-one">
            <b>{event.title}</b>
            <span className="tl-at"> · {clock(start)}</span>
          </span>
        ) : (
          <b>{event.title}</b>
        )}
        {clashIcon && (
          <span
            className="tl-clash"
            title={`Clashes with ${props.clashes.join(', ')}`}
            aria-hidden="true"
          >
            <WarnIcon />
          </span>
        )}
        {showTags && (
          <span className="tl-tags" aria-hidden="true">
            {marks.map((mark) => (
              <span
                key={mark}
                className="tl-tag"
                data-held={mark === 'alerts held' || undefined}
                data-clash={mark.startsWith('clashes with') || undefined}
              >
                {mark}
              </span>
            ))}
          </span>
        )}
        {rows > 1 && (
          <span className="tl-meta">
            {spanText(start, end)} · <CalendarName name={calendar?.title ?? 'Calendar'} />
            {service}
          </span>
        )}
      </button>
      {tip.tooltip}
    </>
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
              data-event-key={event.key}
              data-reply={replyState(event.myStatus).look}
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
          <span>{hourMark(at)}</span>
        </div>
      ))}
      {now !== null && now > span.start && (
        <div className="tl-past" style={{ height: offset(now, span) }} aria-hidden="true" />
      )}
      <div className="tl-lane">
        {props.free.map((free) => {
          const place = block(free.start, free.end, span);
          const minutes = Math.round((free.end - free.start) / 60_000);
          return (
            <div
              key={free.start}
              className="tl-free"
              style={{ top: place.top + 2, height: Math.max(place.height - 4, HOUR_PX / 4) }}
            >
              {duration(minutes)} free
            </div>
          );
        })}
        {placeEvents(props.events).map(({ event, lane, lanes, span: share }) => (
          <EventBlock
            key={event.key}
            event={event}
            lane={lane}
            lanes={lanes}
            span={share}
            ended={hasEnded(event, props.clock)}
            timeline={span}
            calendars={props.calendars}
            clashes={props.clashes.get(event.key) ?? NO_CLASHES}
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
