import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  addLocalDays,
  localDayStart,
  type CalendarDay,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { dateOf, dayTitle, shapeWords } from './calendar-format.ts';
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
  switcher,
  onDate,
  onSelect,
}: DayViewProps) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const panelId = useId();
  const query = useCalendarDay(date, true);
  const day = query.data;
  const isToday = day?.date === today;
  const overlaps = useOverlaps(day, isToday, now, chats);
  const calendars = useMemo(() => calendarMap(day?.calendars), [day]);
  const clashes = useMemo(() => clashMap(day?.events), [day]);
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
  const shownEvent = event ? (shown.find((item) => item.key === event.key) ?? event) : null;
  return (
    <>
      <header className="td-head">
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
        <section className="hpanel td-main" aria-label="Events">
          <NextRow
            events={day.events}
            calendars={calendars}
            isToday={isToday}
            now={now}
            count={shown.length}
          />
          <CalendarFilters calendars={day.calendars} hidden={hidden} onToggle={toggleCalendar} />
          {shown.length === 0 && (
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
            now={isToday ? now : null}
            selected={selected}
            panelId={panelId}
            onSelect={onSelect}
          />
        </section>
        <div className="td-side">
          {shownEvent ? (
            <EventPanel
              key={shownEvent.key}
              id={panelId}
              event={shownEvent}
              date={day.date}
              calendars={calendars}
              clashes={clashes.get(shownEvent.key)}
              isToday={isToday}
              now={now}
              onStartChat={onStartChat}
            />
          ) : (
            <section className="hpanel td-none" aria-labelledby="td-none-h">
              <h2 id="td-none-h">Select an event</h2>
              <p className="td-hint">Pick an event for Join, Open in Calendar and reminders.</p>
            </section>
          )}
          {isToday && <TodayChats chats={chats} overlaps={overlaps} onOpenChat={onOpenChat} />}
        </div>
      </div>
    </>
  );
}
