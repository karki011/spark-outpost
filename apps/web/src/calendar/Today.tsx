import '../home/home.css';
import '../home/home-panels.css';
import './calendar-card.css';
import './today.css';
import { useCallback, useId, useMemo, useState } from 'react';
import {
  addLocalDays,
  localDayStart,
  type CalendarChoice,
  type CalendarDay,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { dateOf, dayTitle, shapeWords } from './calendar-format.ts';
import { DayShapeBar } from './DayShapeBar.tsx';
import { DayTimeline } from './DayTimeline.tsx';
import { EventPanel } from './EventPanel.tsx';
import { NextRow } from './NextRow.tsx';
import { TodayChats, type Overlap } from './TodayChats.tsx';
import { TodayStatePage } from './TodayStates.tsx';
import { noGaps, overlapChat, timelineSpan, todayState, visibleEvents } from './today-model.ts';
import { localDate, useCalendarDay, useCalendarStatus } from './use-calendar.ts';
import { CalendarFilters, WeekStrip } from './WeekStrip.tsx';

interface TodayProps {
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

function TodayDay({ chats, onStartChat, onOpenChat }: TodayProps) {
  const now = useMinuteClock();
  const today = localDate(now);
  const [picked, setPicked] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const panelId = useId();
  const date = picked ?? today;
  const query = useCalendarDay(date, true);
  const day = query.data;
  const isToday = day?.date === today;
  const overlaps = useOverlaps(day, isToday, now, chats);
  const calendars = useMemo(
    () =>
      new Map<string, CalendarChoice>((day?.calendars ?? []).map((choice) => [choice.key, choice])),
    [day],
  );
  const pick = useCallback(
    (next: string) => {
      setPicked(next === today ? null : next);
      setSelected(null);
    },
    [today],
  );
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
            now={isToday ? now : null}
            selected={selected}
            panelId={panelId}
            onSelect={setSelected}
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

function TodayBody(props: TodayProps) {
  const status = useCalendarStatus();
  if (status.isError) return <p className="home-error">{status.error.message}</p>;
  if (!status.data) return <Skeleton label="Loading your calendar" shape="cards" rows={3} />;
  const state = todayState(status.data);
  if (state !== 'ready') return <TodayStatePage state={state} />;
  return <TodayDay {...props} />;
}

export function Today(props: TodayProps) {
  return (
    <main className="page" aria-label="Today">
      <div className="home">
        <div className="td-wrap">
          <TodayBody {...props} />
        </div>
      </div>
    </main>
  );
}
