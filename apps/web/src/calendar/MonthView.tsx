import './month.css';
import { useMemo, useState, type ReactNode } from 'react';
import { clashList, type CalendarChoice, type CalendarEvent } from '@spark-outpost/contracts';
import { dayTitle } from './calendar-format.ts';
import { EventPopover } from './EventPopover.tsx';
import { MonthGrid } from './MonthGrid.tsx';
import { dayEvents, eventsByDay, monthGrid, weekStartDay } from './month-model.ts';
import { ScheduledRail } from './ScheduledRail.tsx';
import { useCalendarRange } from './use-calendar.ts';

interface MonthViewProps {
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

const NO_EVENTS: readonly CalendarEvent[] = [];

export function MonthView(props: MonthViewProps) {
  const { date, today, now } = props;
  const weekStart = useMemo(() => weekStartDay(), []);
  const grid = useMemo(() => monthGrid(date, today, weekStart), [date, today, weekStart]);
  const query = useCalendarRange(grid.from, grid.to);
  const [open, setOpen] = useState<OpenEvent | null>(null);
  const events = query.data?.events ?? NO_EVENTS;
  const byDay = useMemo(() => eventsByDay(events, grid.weeks.flat()), [events, grid]);
  const calendars = useMemo(
    () =>
      new Map<string, CalendarChoice>(
        (query.data?.calendars ?? []).map((choice) => [choice.key, choice]),
      ),
    [query.data],
  );
  const selectedEvents = useMemo(
    () => byDay.get(date) ?? dayEvents(events, date),
    [byDay, events, date],
  );
  const clashes = useMemo(
    () =>
      new Map(
        clashList(selectedEvents, selectedEvents).map((clash) => [clash.eventKey, clash.titles]),
      ),
    [selectedEvents],
  );
  const openEvent = (event: CalendarEvent, anchor: HTMLElement) =>
    setOpen((current) => ({ key: event.key, anchor, opened: (current?.opened ?? 0) + 1 }));
  const shown = open ? (events.find((event) => event.key === open.key) ?? null) : null;
  const pickDate = (next: string) => {
    setOpen(null);
    props.onDate(next);
  };

  return (
    <>
      <header className="td-head">
        <div>
          <h1 id="today-h">Today</h1>
          <p className="td-sub">{dayTitle(today)}</p>
        </div>
        {props.switcher}
      </header>
      {query.isError && <p className="home-error">{query.error.message}</p>}
      {query.data?.truncated && (
        <p className="td-hint">Some events are not shown: this month has too many to read.</p>
      )}
      <div className="mo-layout">
        <MonthGrid
          grid={grid}
          date={date}
          byDay={byDay}
          calendars={calendars}
          loading={query.isPending}
          weekStart={weekStart}
          onDate={pickDate}
          onOpenDay={props.onOpenDay}
          onOpenEvent={openEvent}
        />
        <ScheduledRail
          date={date}
          today={today}
          now={now}
          events={selectedEvents}
          calendars={calendars}
          clashes={clashes}
          loading={query.isPending}
          onDate={pickDate}
          onOpenDay={props.onOpenDay}
          onOpenEvent={openEvent}
        />
      </div>
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
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
