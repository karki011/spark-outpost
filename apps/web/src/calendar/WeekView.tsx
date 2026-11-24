import './month.css';
import './week.css';
import { useCallback, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { spanOf, type CalendarChoice, type CalendarEvent } from '@spark-outpost/contracts';
import { clock, dayTitle, hourMark, span as spanText } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { eventEnds, hasEnded, useEventClock } from './event-clock.ts';
import { EventPopover } from './EventPopover.tsx';
import { eventsByDay, shiftDay, weekStartDay, WEEK_DAYS, type MonthCell } from './month-model.ts';
import { replyState } from './reply-status.ts';
import { StepButtons } from './StepButtons.tsx';
import { placeEvents } from './timeline-model.ts';
import { calendarMap, clashMap } from './today-model.ts';
import { localDate, useCalendarRange } from './use-calendar.ts';
import { useShowWeekends } from './use-show-weekends.ts';
import {
  daySpan,
  weekBlock,
  weekHours,
  weekModel,
  weekOffset,
  weekTitle,
  WEEK_HOUR_PX,
  type WeekHours,
} from './week-model.ts';

interface WeekViewProps {
  date: string;
  today: string;
  now: number;
  switcher: ReactNode;
  onDate: (date: string) => void;
  onOpenDay: (date: string) => void;
  onStartChat: (text: string) => void;
}

interface OpenEvent {
  key: string;
  anchor: HTMLElement;
  opened: number;
}

type Calendars = ReadonlyMap<string, CalendarChoice>;
type OpenHandler = (event: CalendarEvent, anchor: HTMLElement) => void;

const NO_EVENTS: readonly CalendarEvent[] = [];

function eventLabel(event: CalendarEvent, calendars: Calendars): string {
  const { start, end } = spanOf(event);
  const when = event.allDay ? 'all day' : spanText(start, end);
  const reply = replyState(event.myStatus).word;
  const calendar = calendars.get(event.calendarKey)?.title ?? 'Calendar';
  return `${event.title}, ${when}, ${calendar}${reply ? `, ${reply}` : ''}`;
}

function DayHead({ day, onOpenDay }: { day: MonthCell; onOpenDay: (date: string) => void }) {
  const at = new Date(day.dayStart);
  return (
    <button
      type="button"
      className="wk-day"
      aria-current={day.today ? 'date' : undefined}
      aria-label={`${dayTitle(day.date)}${day.today ? ', today' : ''}. Open in Day view`}
      onClick={() => onOpenDay(day.date)}
    >
      <span className="wk-weekday">{at.toLocaleDateString(undefined, { weekday: 'short' })}</span>
      <span className="wk-num">{at.getDate()}</span>
    </button>
  );
}

function AllDay(props: {
  events: readonly CalendarEvent[];
  calendars: Calendars;
  selected: string | null;
  onOpen: OpenHandler;
}) {
  return (
    <div className="wk-allday">
      {props.events
        .filter((event) => event.allDay)
        .map((event) => (
          <button
            key={event.key}
            type="button"
            className="wk-ev wk-chip"
            data-reply={replyState(event.myStatus).look}
            style={swatch(props.calendars.get(event.calendarKey)?.color ?? '') as CSSProperties}
            aria-haspopup="dialog"
            aria-expanded={props.selected === event.key}
            aria-label={eventLabel(event, props.calendars)}
            onClick={(click) => props.onOpen(event, click.currentTarget)}
          >
            {event.title}
          </button>
        ))}
    </div>
  );
}

function DayColumn(props: {
  day: MonthCell;
  hours: WeekHours;
  events: readonly CalendarEvent[];
  calendars: Calendars;
  now: number;
  selected: string | null;
  onOpen: OpenHandler;
}) {
  const { day, calendars, now } = props;
  const span = daySpan(day.dayStart, props.hours);
  const showNow = day.today && now >= span.start && now <= span.end;
  return (
    <div className="wk-col" role="group" aria-label={dayTitle(day.date)} data-date={day.date}>
      {placeEvents(props.events).map(({ event, lane, lanes, span: share }) => {
        const place = weekBlock(event, span);
        const style = {
          ...swatch(calendars.get(event.calendarKey)?.color ?? ''),
          top: place.top,
          height: place.height,
          left: `${(lane / lanes) * 100}%`,
          width: `calc(${(share / lanes) * 100}% - 3px)`,
        } as CSSProperties;
        return (
          <button
            key={event.key}
            type="button"
            className="wk-ev wk-block"
            data-event-key={event.key}
            data-ended={hasEnded(event, now) || undefined}
            data-reply={replyState(event.myStatus).look}
            style={style}
            aria-haspopup="dialog"
            aria-expanded={props.selected === event.key}
            aria-label={eventLabel(event, calendars)}
            onClick={(click) => props.onOpen(event, click.currentTarget)}
          >
            <span className="wk-title">{event.title}</span>
            {place.twoLines && <span className="wk-time">{clock(spanOf(event).start)}</span>}
          </button>
        );
      })}
      {showNow && (
        <div className="wk-now" style={{ top: weekOffset(now, span) }} aria-hidden="true" />
      )}
    </div>
  );
}

function HourGutter({ hours, dayStart }: { hours: WeekHours; dayStart: number }) {
  const marks = Array.from({ length: hours.end - hours.start }, (_, index) => hours.start + index);
  return (
    <div className="wk-gutter" aria-hidden="true">
      {marks.map((hour) => (
        <span key={hour} style={{ top: (hour - hours.start) * WEEK_HOUR_PX }}>
          {hourMark(new Date(dayStart).setHours(hour, 0, 0, 0))}
        </span>
      ))}
    </div>
  );
}

export function WeekView(props: WeekViewProps) {
  const { date, today, onDate } = props;
  const weekStart = useMemo(() => weekStartDay(), []);
  const [weekends, setWeekends] = useShowWeekends();
  const titleId = useId();
  const week = useMemo(
    () => weekModel(date, today, weekStart, weekends),
    [date, today, weekStart, weekends],
  );
  const query = useCalendarRange(week.from, week.to);
  const [open, setOpen] = useState<OpenEvent | null>(null);
  const events = query.data?.events ?? NO_EVENTS;
  const ends = useMemo(() => eventEnds(events), [events]);
  const now = Math.max(props.now, useEventClock(ends, query.dataUpdatedAt));
  const byDay = useMemo(() => eventsByDay(events, week.days), [events, week]);
  const calendars = useMemo(() => calendarMap(query.data?.calendars), [query.data]);
  const hours = useMemo(() => weekHours(week.shown, byDay), [week, byDay]);
  const openEvent = useCallback<OpenHandler>(
    (event, anchor) =>
      setOpen((current) => ({ key: event.key, anchor, opened: (current?.opened ?? 0) + 1 })),
    [],
  );
  const pickDate = useCallback(
    (next: string) => {
      setOpen(null);
      onDate(next);
    },
    [onDate],
  );
  const closePopover = useCallback(() => setOpen(null), []);
  const shown = open ? (events.find((event) => event.key === open.key) ?? null) : null;
  const shownDay = shown
    ? localDate(Math.max(spanOf(shown).start, week.days[0]?.dayStart ?? 0))
    : '';
  const clashes = useMemo(() => clashMap(byDay.get(shownDay) ?? NO_EVENTS), [byDay, shownDay]);
  const columns = { '--wk-days': week.shown.length } as CSSProperties;

  return (
    <div className="mo-page wk-page">
      <header className="mo-bar">
        <div className="mo-title">
          <h1 id={titleId}>{weekTitle(week.shown)}</h1>
        </div>
        <span className="mo-steps">
          <StepButtons
            unit="week"
            onStep={(delta) => pickDate(shiftDay(date, delta * WEEK_DAYS))}
          />
        </span>
        <button
          type="button"
          className="btn line sm"
          onClick={() => pickDate(localDate(Date.now()))}
        >
          Today
        </button>
        <label className="wk-weekends">
          <input
            type="checkbox"
            checked={weekends}
            onChange={(change) => setWeekends(change.target.checked)}
          />
          Show weekends
        </label>
        {props.switcher}
      </header>
      {query.isError && <p className="home-error">{query.error.message}</p>}
      {query.data?.truncated && (
        <p className="td-hint">Some events are not shown: this week has too many to read.</p>
      )}
      <section
        className="wk"
        style={columns}
        aria-labelledby={titleId}
        aria-busy={query.isPending || query.isPlaceholderData}
      >
        <div className="wk-head">
          <span className="wk-corner" />
          {week.shown.map((day) => (
            <DayHead key={day.date} day={day} onOpenDay={props.onOpenDay} />
          ))}
          <span className="wk-corner" />
          {week.shown.map((day) => (
            <AllDay
              key={day.date}
              events={byDay.get(day.date) ?? NO_EVENTS}
              calendars={calendars}
              selected={open?.key ?? null}
              onOpen={openEvent}
            />
          ))}
        </div>
        <div className="wk-scroll">
          <div className="wk-body" style={{ height: (hours.end - hours.start) * WEEK_HOUR_PX }}>
            <HourGutter hours={hours} dayStart={week.days[0]?.dayStart ?? 0} />
            {week.shown.map((day) => (
              <DayColumn
                key={day.date}
                day={day}
                hours={hours}
                events={byDay.get(day.date) ?? NO_EVENTS}
                calendars={calendars}
                now={now}
                selected={open?.key ?? null}
                onOpen={openEvent}
              />
            ))}
          </div>
        </div>
      </section>
      {open && shown && (
        <EventPopover
          key={open.opened}
          event={shown}
          anchor={open.anchor}
          calendars={calendars}
          clashes={clashes.get(shown.key)}
          today={today}
          now={now}
          onStartChat={props.onStartChat}
          onClose={closePopover}
        />
      )}
    </div>
  );
}
