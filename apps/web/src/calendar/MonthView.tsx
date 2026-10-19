import './month.css';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import type { CalendarEvent } from '@spark-outpost/contracts';
import { EventPopover } from './EventPopover.tsx';
import { MonthBar } from './MonthBar.tsx';
import { MonthGrid } from './MonthGrid.tsx';
import { eventsByDay, monthGrid, weekStartDay } from './month-model.ts';
import { useStoredPanelWidth } from '../ui/panel-width.ts';
import { RAIL_WIDTH, ScheduledRail } from './ScheduledRail.tsx';
import { calendarMap, clashMap } from './today-model.ts';
import { useCalendarRange } from './use-calendar.ts';
import { eventEnds, useEventClock } from './event-clock.ts';

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
  const { date, today, onDate } = props;
  const weekStart = useMemo(() => weekStartDay(), []);
  const titleId = useId();
  const month = date.slice(0, 7);
  const grid = useMemo(() => monthGrid(`${month}-01`, today, weekStart), [month, today, weekStart]);
  const query = useCalendarRange(grid.from, grid.to);
  const loading = query.isPending || query.isPlaceholderData;
  const [open, setOpen] = useState<OpenEvent | null>(null);
  const [railWidth, setRailWidth] = useStoredPanelWidth(RAIL_WIDTH);
  const events = query.data?.events ?? NO_EVENTS;
  const ends = useMemo(() => eventEnds(events), [events]);
  const now = Math.max(props.now, useEventClock(ends, query.dataUpdatedAt));
  const byDay = useMemo(() => eventsByDay(events, grid.weeks.flat()), [events, grid]);
  const calendars = useMemo(() => calendarMap(query.data?.calendars), [query.data]);
  const selectedEvents = byDay.get(date) ?? NO_EVENTS;
  const clashes = useMemo(() => clashMap(selectedEvents), [selectedEvents]);
  const openEvent = useCallback(
    (event: CalendarEvent, anchor: HTMLElement) =>
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

  return (
    <div className="mo-page">
      <MonthBar
        grid={grid}
        date={date}
        today={today}
        titleId={titleId}
        switcher={props.switcher}
        onDate={pickDate}
      />
      {query.isError && <p className="home-error">{query.error.message}</p>}
      {query.data?.truncated && (
        <p className="td-hint">Some events are not shown: this month has too many to read.</p>
      )}
      <div className="mo-layout">
        <MonthGrid
          grid={grid}
          date={date}
          titleId={titleId}
          byDay={byDay}
          calendars={calendars}
          loading={loading}
          selected={open?.key ?? null}
          now={now}
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
          loading={loading}
          selected={open?.key ?? null}
          width={railWidth}
          onWidth={setRailWidth}
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
          onClose={closePopover}
        />
      )}
    </div>
  );
}
