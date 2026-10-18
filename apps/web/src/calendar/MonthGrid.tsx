import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { CalendarChoice, CalendarEvent } from '@spark-outpost/contracts';
import { ChoicePicker, type PickerChoice } from '../ui/ChoicePicker.tsx';
import { countLabel } from '../ui/count-label.ts';
import { clock, dayTitle } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { StepButtons } from './StepButtons.tsx';
import {
  keyMove,
  preview,
  setMonth,
  shiftMonth,
  type MonthCell,
  type MonthGridModel,
} from './month-model.ts';
import { localDate } from './use-calendar.ts';

const YEARS_AROUND = 5;

interface MonthGridProps {
  grid: MonthGridModel;
  date: string;
  byDay: ReadonlyMap<string, CalendarEvent[]>;
  calendars: ReadonlyMap<string, CalendarChoice>;
  loading: boolean;
  weekStart: number;
  onDate: (date: string) => void;
  onOpenDay: (date: string) => void;
  onOpenEvent: (event: CalendarEvent, anchor: HTMLElement) => void;
}

function monthName(month: number): string {
  return new Date(2000, month, 1).toLocaleDateString(undefined, { month: 'long' });
}

const MONTH_CHOICES: PickerChoice[] = Array.from({ length: 12 }, (_, month) => ({
  id: String(month),
  label: monthName(month),
}));

function yearsAround(year: number): number[] {
  const current = new Date().getFullYear();
  const first = Math.min(current - YEARS_AROUND, year);
  const last = Math.max(current + YEARS_AROUND, year);
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function MonthBar(props: Pick<MonthGridProps, 'grid' | 'date' | 'onDate'> & { titleId: string }) {
  const { grid, date, onDate } = props;
  return (
    <div className="mo-bar">
      <h2 id={props.titleId} className="sr-only">
        {monthName(grid.month)} {grid.year}
      </h2>
      <span className="mo-pick">
        <ChoicePicker
          label="Month"
          choices={MONTH_CHOICES}
          value={String(grid.month)}
          onChange={(month) => onDate(setMonth(date, grid.year, Number(month)))}
        />
      </span>
      <span className="mo-pick mo-year">
        <ChoicePicker
          label="Year"
          choices={yearsAround(grid.year).map((year) => ({
            id: String(year),
            label: String(year),
          }))}
          value={String(grid.year)}
          onChange={(year) => onDate(setMonth(date, Number(year), grid.month))}
        />
      </span>
      <span className="mo-bar-end">
        <button type="button" className="btn line sm" onClick={() => onDate(localDate(Date.now()))}>
          Today
        </button>
        <StepButtons unit="month" onStep={(delta) => onDate(shiftMonth(date, delta))} />
      </span>
    </div>
  );
}

function cellLabel(cell: MonthCell, events: readonly CalendarEvent[]): string {
  const { shown, more } = preview(events);
  const count = events.length > 0 ? countLabel(events.length, 'event') : 'no events';
  const titles = shown.map((event) => event.title).join(', ');
  const rest = more > 0 ? ` and ${more} more` : '';
  const today = cell.today ? ', today' : '';
  return `${dayTitle(cell.date)}${today}, ${count}${titles ? `: ${titles}${rest}` : ''}`;
}

function eventLabel(event: CalendarEvent): string {
  return event.allDay ? event.title : `${clock(Date.parse(event.start))} ${event.title}`;
}

interface CellProps {
  cell: MonthCell;
  events: readonly CalendarEvent[];
  selected: boolean;
  calendars: ReadonlyMap<string, CalendarChoice>;
  onDate: (date: string) => void;
  onOpenDay: (date: string) => void;
  onOpenEvent: (event: CalendarEvent, anchor: HTMLElement) => void;
}

const DayCell = memo(function DayCell({
  cell,
  events,
  selected,
  calendars,
  ...actions
}: CellProps) {
  const { shown, more } = preview(events);
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
      <span className="mo-evs" aria-hidden="true">
        {shown.map((event) => (
          <button
            key={event.key}
            type="button"
            tabIndex={-1}
            className="mo-ev"
            data-focus={event.focus || undefined}
            style={swatch(calendars.get(event.calendarKey)?.color ?? '') as CSSProperties}
            title={eventLabel(event)}
            onClick={openEvent(event)}
          >
            {event.title}
          </button>
        ))}
        {more > 0 && <span className="mo-more">+{more} more</span>}
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
  const { grid, date, weekStart, onDate, onOpenDay } = props;
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const titleId = useId();
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
    <section className="hpanel mo-panel" aria-labelledby={titleId} aria-busy={props.loading}>
      <MonthBar grid={grid} date={date} onDate={onDate} titleId={titleId} />
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
                calendars={props.calendars}
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
