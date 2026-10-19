import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { CalendarChoice, CalendarEvent } from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';
import { clock, dayTitle } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { hasEnded } from './event-clock.ts';
import { MoreEvents } from './MoreEvents.tsx';
import { keyMove, preview, type MonthCell, type MonthGridModel } from './month-model.ts';
import { useTitlesThatFit } from './use-titles-fit.ts';

const LABEL_TITLES = 3;

interface MonthGridProps {
  grid: MonthGridModel;
  date: string;
  titleId: string;
  byDay: ReadonlyMap<string, CalendarEvent[]>;
  calendars: ReadonlyMap<string, CalendarChoice>;
  loading: boolean;
  selected: string | null;
  now: number;
  weekStart: number;
  onDate: (date: string) => void;
  onOpenDay: (date: string) => void;
  onOpenEvent: (event: CalendarEvent, anchor: HTMLElement) => void;
}

function cellLabel(cell: MonthCell, events: readonly CalendarEvent[]): string {
  const count = events.length > 0 ? countLabel(events.length, 'event') : 'no events';
  const titles = events
    .slice(0, LABEL_TITLES)
    .map((event) => event.title)
    .join(', ');
  const more = events.length - LABEL_TITLES;
  const rest = more > 0 ? ` and ${more} more` : '';
  const today = cell.today ? ', today' : '';
  return `${dayTitle(cell.date)}${today}, ${count}${titles ? `: ${titles}${rest}` : ''}`;
}

function startClock(event: CalendarEvent): string | null {
  return event.allDay ? null : clock(Date.parse(event.start));
}

function eventLabel(event: CalendarEvent): string {
  const at = startClock(event);
  return at ? `${at} ${event.title}` : event.title;
}

interface CellProps {
  cell: MonthCell;
  events: readonly CalendarEvent[];
  selected: boolean;
  limit: number;
  calendars: ReadonlyMap<string, CalendarChoice>;
  openKey: string | null;
  now: number;
  onDate: (date: string) => void;
  onOpenDay: (date: string) => void;
  onOpenEvent: (event: CalendarEvent, anchor: HTMLElement) => void;
}

const DayCell = memo(function DayCell({
  cell,
  events,
  selected,
  limit,
  calendars,
  openKey,
  now,
  ...actions
}: CellProps) {
  const { shown, more } = preview(events, limit);
  const openEvent = (event: CalendarEvent) => (click: MouseEvent<HTMLButtonElement>) => {
    click.stopPropagation();
    actions.onDate(cell.date);
    actions.onOpenEvent(event, click.currentTarget);
  };
  return (
    <div
      role="gridcell"
      className="mo-cell"
      data-date={cell.date}
      data-past={cell.past || undefined}
      data-out={!cell.inMonth || undefined}
      data-today={cell.today || undefined}
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      aria-current={cell.today ? 'date' : undefined}
      aria-label={cellLabel(cell, events)}
      onClick={() => actions.onDate(cell.date)}
      onDoubleClick={() => actions.onOpenDay(cell.date)}
    >
      <span className="mo-num" aria-hidden="true">
        {new Date(cell.dayStart).getDate()}
      </span>
      <span className="mo-evs">
        {shown.map((event) => (
          <button
            key={event.key}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="mo-ev"
            data-focus={event.focus || undefined}
            data-selected={event.key === openKey || undefined}
            data-ended={hasEnded(event, now) || undefined}
            style={swatch(calendars.get(event.calendarKey)?.color ?? '') as CSSProperties}
            title={eventLabel(event)}
            onClick={openEvent(event)}
          >
            {!event.allDay && <span className="mo-at">{startClock(event)}</span>}
            <span className="mo-ev-title">{event.title}</span>
          </button>
        ))}
        {more > 0 && (
          <MoreEvents
            date={cell.date}
            events={events.slice(shown.length)}
            calendars={calendars}
            focusable={selected}
            onDate={actions.onDate}
            onOpenEvent={actions.onOpenEvent}
          />
        )}
      </span>
    </div>
  );
});

const NO_EVENTS: readonly CalendarEvent[] = [];

function weekdayLabels(week: readonly MonthCell[]) {
  return week.map((cell) => {
    const day = new Date(cell.dayStart);
    return {
      key: cell.date,
      short: day.toLocaleDateString(undefined, { weekday: 'short' }),
      long: day.toLocaleDateString(undefined, { weekday: 'long' }),
    };
  });
}

export function MonthGrid(props: MonthGridProps) {
  const { grid, date, titleId, weekStart, onDate, onOpenDay } = props;
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const limit = useTitlesThatFit(gridRef);
  const weekdays = useMemo(() => weekdayLabels(grid.weeks[0]!), [grid]);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  }, [date, grid]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.getAttribute('role') !== 'gridcell') {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenDay(date);
      return;
    }
    const next = keyMove(event.key, date, weekStart);
    if (next === null) return;
    event.preventDefault();
    moved.current = true;
    onDate(next);
  };

  return (
    <section className="mo-panel" aria-labelledby={titleId} aria-busy={props.loading}>
      <div
        ref={gridRef}
        role="grid"
        className="mo-grid"
        aria-labelledby={titleId}
        aria-readonly="true"
        onKeyDown={onKeyDown}
      >
        <div role="row" className="mo-row mo-head">
          {weekdays.map((weekday) => (
            <span key={weekday.key} role="columnheader" className="mo-wd">
              <abbr title={weekday.long}>{weekday.short}</abbr>
            </span>
          ))}
        </div>
        {grid.weeks.map((week) => (
          <div key={week[0]!.date} role="row" className="mo-row">
            {week.map((cell) => (
              <DayCell
                key={cell.date}
                cell={cell}
                events={props.byDay.get(cell.date) ?? NO_EVENTS}
                selected={cell.date === date}
                limit={limit}
                calendars={props.calendars}
                openKey={cell.date === date ? props.selected : null}
                now={props.now}
                onDate={onDate}
                onOpenDay={onOpenDay}
                onOpenEvent={props.onOpenEvent}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="td-hint mo-keys">
        Arrow keys move between days, Enter opens the day, Page Up and Page Down change month.
      </p>
    </section>
  );
}
