import type { ReactNode } from 'react';
import { BlobScout } from '../brand/BlobScout.tsx';
import { openCalendarCard } from './calendar-open.ts';
import type { TodayState } from './today-model.ts';
import { useOpenCalendarSettings } from './use-calendar.ts';

function StatePage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="td-state">
      <BlobScout size={54} mood="sleep" />
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function Denied() {
  const open = useOpenCalendarSettings();
  return (
    <StatePage title="Calendars access is off">
      <p>Spark Outpost needs Calendars access in System Settings → Privacy &amp; Security.</p>
      <button type="button" className="btn primary" onClick={() => open.mutate()}>
        Open Calendar settings
      </button>
      {open.error && <p className="home-error">{open.error.message}</p>}
    </StatePage>
  );
}

export function TodayStatePage({ state }: { state: Exclude<TodayState, 'ready'> }) {
  if (state === 'web') {
    return (
      <StatePage title="Today lives in the Mac app">
        <p>Your calendar is read on your Mac. Open Spark Outpost there to see it.</p>
      </StatePage>
    );
  }
  if (state === 'helper') {
    return (
      <StatePage title="The calendar helper isn’t available">
        <p>
          Spark Outpost couldn’t start its calendar helper. From source, run{' '}
          <code>pnpm desktop:calendar</code>.
        </p>
      </StatePage>
    );
  }
  if (state === 'denied') return <Denied />;
  if (state === 'none') {
    return (
      <StatePage title="No calendars included">
        <p>Pick the calendars Spark should show in Connections → Connectors → Calendar.</p>
        <button type="button" className="btn primary" onClick={openCalendarCard}>
          Choose calendars
        </button>
      </StatePage>
    );
  }
  return (
    <StatePage title="See your day next to your chats">
      <ul className="td-benefits">
        <li>Your meetings beside your chats, from Mac Calendar and Google Calendar.</li>
        <li>A nudge before each one with what needs you, and Join in one click.</li>
        <li>Quiet focus time: Spark Island holds its chimes until you’re done.</li>
      </ul>
      <button type="button" className="btn primary" onClick={openCalendarCard}>
        Connect calendar
      </button>
    </StatePage>
  );
}
