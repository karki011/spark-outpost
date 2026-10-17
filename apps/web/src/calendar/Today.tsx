import '../home/home.css';
import '../home/home-panels.css';
import './calendar-card.css';
import './today.css';
import { useCallback, useState } from 'react';
import { Segmented } from '../ui/Segmented.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { DayView, type TodayProps } from './DayView.tsx';
import { MonthView } from './MonthView.tsx';
import { TodayStatePage } from './TodayStates.tsx';
import { todayState } from './today-model.ts';
import { localDate, useCalendarStatus } from './use-calendar.ts';
import { useTodayEventRequests } from './today-request.ts';

type CalendarView = 'month' | 'day';

const VIEWS = [
  { id: 'month', label: 'Month' },
  { id: 'day', label: 'Day' },
];

const VIEW_KEY = 'spark.today.view';

function savedView(): CalendarView {
  try {
    return sessionStorage.getItem(VIEW_KEY) === 'day' ? 'day' : 'month';
  } catch {
    return 'month';
  }
}

function useCalendarView() {
  const [view, setView] = useState<CalendarView>(savedView);
  const choose = useCallback((next: CalendarView) => {
    setView(next);
    try {
      sessionStorage.setItem(VIEW_KEY, next);
    } catch {
      return;
    }
  }, []);
  return [view, choose] as const;
}

function TodayViews(props: TodayProps) {
  const now = useMinuteClock();
  const today = localDate(now);
  const [view, setView] = useCalendarView();
  const [picked, setPicked] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const date = picked ?? today;
  const pickDate = useCallback(
    (next: string) => setPicked(next === localDate(Date.now()) ? null : next),
    [],
  );
  const openDay = useCallback(
    (next: string) => {
      pickDate(next);
      setSelected(null);
      setView('day');
    },
    [pickDate, setView],
  );
  const showEvent = useCallback(
    (eventKey: string) => {
      setPicked(null);
      setSelected(eventKey);
      setView('day');
    },
    [setView],
  );
  useTodayEventRequests(showEvent);
  const switcher = (
    <div className="td-views">
      <Segmented
        ariaLabel="Calendar view"
        options={VIEWS}
        value={view}
        onChange={(id) => setView(id as CalendarView)}
      />
    </div>
  );
  if (view === 'day') {
    return (
      <DayView
        {...props}
        date={date}
        today={today}
        now={now}
        selected={selected}
        switcher={switcher}
        onDate={pickDate}
        onSelect={setSelected}
      />
    );
  }
  return (
    <MonthView
      date={date}
      today={today}
      now={now}
      switcher={switcher}
      onDate={pickDate}
      onOpenDay={openDay}
      onStartChat={props.onStartChat}
    />
  );
}

function TodayBody(props: TodayProps) {
  const status = useCalendarStatus();
  if (status.isError) return <p className="home-error">{status.error.message}</p>;
  if (!status.data) return <Skeleton label="Loading your calendar" shape="cards" rows={3} />;
  const state = todayState(status.data);
  if (state !== 'ready') return <TodayStatePage state={state} />;
  return <TodayViews {...props} />;
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
