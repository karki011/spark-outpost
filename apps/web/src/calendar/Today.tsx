import '../home/home.css';
import '../home/home-panels.css';
import './calendar-card.css';
import './today.css';
import { useCallback, useState } from 'react';
import { Segmented } from '../ui/Segmented.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { CopyToasts } from './copy-toast.tsx';
import { DayView, type TodayProps } from './DayView.tsx';
import { MonthView } from './MonthView.tsx';
import { RefreshCalendar } from './RefreshCalendar.tsx';
import { TodayStatePage } from './TodayStates.tsx';
import { todayState } from './today-model.ts';
import { localDate, useCalendarStatus } from './use-calendar.ts';
import { useTodayEventRequests, type TodayEventRequest } from './today-request.ts';
import { MeetingsView } from './MeetingsView.tsx';
import { RecordingBar, useMeetingStatus } from '../meetings/index.ts';

type CalendarView = 'month' | 'day' | 'meetings';

const VIEWS = [
  { id: 'month', label: 'Month' },
  { id: 'day', label: 'Day' },
];

const VIEWS_WITH_MEETINGS = [...VIEWS, { id: 'meetings', label: 'Meetings' }];

const VIEW_KEY = 'spark.today.view';

function savedView(): CalendarView {
  try {
    const saved = sessionStorage.getItem(VIEW_KEY);
    return saved === 'day' || saved === 'meetings' ? saved : 'month';
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
  const [flash, setFlash] = useState(0);
  const [requested, setRequested] = useState<TodayEventRequest | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const meetings = useMeetingStatus().data?.available ?? false;
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
    (request: TodayEventRequest) => {
      pickDate(request.date ?? localDate(Date.now()));
      setSelected(request.eventKey);
      setRequested(request);
      if (request.eventKey) setFlash((count) => count + 1);
      setView('day');
    },
    [pickDate, setView],
  );
  useTodayEventRequests(showEvent);
  const switcher = (
    <div className="td-tools">
      <RefreshCalendar />
      <div className="td-views">
        <Segmented
          ariaLabel="Calendar view"
          options={meetings ? VIEWS_WITH_MEETINGS : VIEWS}
          value={view}
          onChange={(id) => setView(id as CalendarView)}
        />
      </div>
    </div>
  );
  const openMeeting = (id: string) => {
    setMeetingId(id);
    setView('meetings');
  };
  const recording = <RecordingBar onOpen={openMeeting} />;
  if (view === 'meetings' && meetings) {
    return (
      <>
        {recording}
        <MeetingsView
          key={meetingId ?? 'list'}
          today={today}
          initialId={meetingId}
          switcher={switcher}
          onStartChat={props.onStartChat}
        />
      </>
    );
  }
  if (view === 'day') {
    return (
      <>
        {recording}
        <DayView
          {...props}
          date={date}
          today={today}
          now={now}
          selected={selected}
          flash={flash}
          requested={requested?.date === date ? requested.eventKey : null}
          switcher={switcher}
          onDate={pickDate}
          onSelect={setSelected}
        />
      </>
    );
  }
  return (
    <>
      {recording}
      <MonthView
        date={date}
        today={today}
        now={now}
        switcher={switcher}
        onDate={pickDate}
        onOpenDay={openDay}
        onStartChat={props.onStartChat}
      />
    </>
  );
}

function TodayBody(props: TodayProps) {
  const status = useCalendarStatus();
  if (status.isError) return <p className="home-error">{status.error.message}</p>;
  if (!status.data) return <Skeleton label="Loading your calendar" shape="cards" rows={3} />;
  const state = todayState(status.data);
  if (state !== 'ready') return <TodayStatePage state={state} />;
  return (
    <CopyToasts>
      <TodayViews {...props} />
    </CopyToasts>
  );
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
