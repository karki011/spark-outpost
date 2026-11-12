import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  addLocalDays,
  localDayStart,
  type CalendarDay,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { dateOf, dayTitle, shapeWords } from './calendar-format.ts';
import { DateTile } from './DateTile.tsx';
import { DayShapeBar } from './DayShapeBar.tsx';
import { DayTimeline } from './DayTimeline.tsx';
import { EventPanel } from './EventPanel.tsx';
import { NextRow } from './NextRow.tsx';
import { TodayChats, type Overlap } from './TodayChats.tsx';
import {
  calendarMap,
  clashMap,
  noGaps,
  overlapChat,
  timelineSpan,
  visibleEvents,
} from './today-model.ts';
import { useCalendarDay } from './use-calendar.ts';
import { useRevealEvent } from './use-reveal-event.ts';
import { eventEnds, useEventClock } from './event-clock.ts';
import { CalendarFilters, WeekStrip } from './WeekStrip.tsx';

export interface TodayProps {
  chats: readonly ConversationSummary[];
  onStartChat: (text: string) => void;
  onOpenChat: (id: string) => void;
}

function useOverlaps(
  day: CalendarDay | undefined,
  isToday: boolean,
  now: number,
  chats: TodayProps['chats'],
) {
  return useMemo<Overlap[]>(() => {
    if (!day || !isToday) return [];
    return day.events.flatMap((event) => {
      const chat = overlapChat(event, now, chats);
      return chat ? [{ event, chat }] : [];
    });
  }, [day, isToday, now, chats]);
}

interface DayViewProps extends TodayProps {
  date: string;
  today: string;
  now: number;
  selected: string | null;
  flash: number;
  requested: string | null;
  switcher: ReactNode;
  onDate: (date: string) => void;
  onSelect: (eventKey: string | null) => void;
}

export function DayView({
  chats,
  onStartChat,
  onOpenChat,
  date,
  today,
  now,
  selected,
  flash,
  requested,
  switcher,
  onDate,
  onSelect,
}: DayViewProps) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const panelId = useId();
  const query = useCalendarDay(date, true);
  const day = query.data;
  const stale = query.isPlaceholderData;
  const isToday = day?.date === today;
  const overlaps = useOverlaps(day, isToday, now, chats);
  const calendars = useMemo(() => calendarMap(day?.calendars), [day]);
  const clashes = useMemo(() => clashMap(day?.events), [day]);
  const ends = useMemo(() => eventEnds(day?.events ?? []), [day]);
  const clock = Math.max(now, useEventClock(ends, query.dataUpdatedAt));
  const settled = day !== undefined && day.date === date && !stale;
  useRevealEvent(selected, flash, settled);
  const pick = (next: string) => {
    onDate(next);
    onSelect(null);
  };
  const toggleCalendar = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!day) {
    if (query.isError) return <p className="home-error">{query.error.message}</p>;
    return <Skeleton label="Loading your day" shape="cards" rows={4} />;
  }
  const dayStart = localDayStart(dateOf(day.date).getTime());
  const shown = visibleEvents(day.events, hidden);
  const span = timelineSpan(dayStart, addLocalDays(dayStart, 1), shown);
  const event = day.events.find((item) => item.key === selected) ?? null;
  return (
    <div className="td-card">
      <header className="td-head">
        <DateTile date={day.date} />
        <div>
          <h1 id="today-h">
            {isToday
              ? 'Today'
              : dateOf(day.date).toLocaleDateString(undefined, { weekday: 'long' })}
          </h1>
          <p className="td-sub">{dayTitle(day.date)}</p>
        </div>
        {switcher}
        <div className="td-shape">
          <DayShapeBar shape={day.shape} dayStart={dayStart} label="Day shape" />
          <p className="td-words">{shapeWords(day.shape)}</p>
        </div>
      </header>
      <WeekStrip week={day.week} date={date} onPick={pick} />
      <div className="td-grid">
        <section className="hpanel td-main" aria-label="Events" aria-busy={stale}>
          <NextRow
            events={day.events}
            calendars={calendars}
            isToday={isToday}
            now={now}
            count={shown.length}
          />
          <CalendarFilters calendars={day.calendars} hidden={hidden} onToggle={toggleCalendar} />
          {shown.length === 0 && !stale && (
            <p className="hquiet">Light day: nothing on the calendars you show.</p>
          )}
          <DayTimeline
            span={span}
            events={shown}
            free={day.free}
            calendars={calendars}
            gaps={noGaps(shown)}
            overlaps={new Set(overlaps.map((overlap) => overlap.event.key))}
            clashes={clashes}
            now={isToday ? clock : null}
            clock={clock}
            selected={selected}
            panelId={panelId}
            onSelect={onSelect}
          />
        </section>
        <div className="td-side">
          {!event && selected !== null && selected === requested && settled ? (
            <p className="td-hint td-none" role="status">
              This event is no longer on your calendar.
            </p>
          ) : event ? (
            <EventPanel
              key={event.key}
              id={panelId}
              event={event}
              date={day.date}
              calendars={calendars}
              clashes={clashes.get(event.key)}
              now={now}
              onStartChat={onStartChat}
            />
          ) : (
            <p className="td-hint td-none">Select an event for Join and reminders.</p>
          )}
          {isToday && <TodayChats chats={chats} overlaps={overlaps} onOpenChat={onOpenChat} />}
        </div>
      </div>
    </div>
  );
}
