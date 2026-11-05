import { lazy, Suspense } from 'react';
import type { DayCalendarProps } from './DayCalendarGrid.tsx';
import './day-calendar.css';

const WEEKS = 6;
const DAYS = 7;

const loadGrid = () =>
  import('./DayCalendarGrid.tsx').then((module) => ({ default: module.DayCalendarGrid }));

const Grid = lazy(loadGrid);

export function preloadDayCalendar(): void {
  void loadGrid().catch(() => undefined);
}

function DayCalendarSkeleton() {
  return (
    <div className="day-grid day-grid-skel" aria-busy="true">
      <span className="sr-only" role="status">
        Loading the calendar
      </span>
      <span className="day-skel-caption" aria-hidden="true" />
      <div className="day-skel-days" aria-hidden="true">
        {Array.from({ length: (WEEKS + 1) * DAYS }, (_, index) => (
          <span key={index} className={index < DAYS ? 'day-skel-weekday' : 'day-skel-day'} />
        ))}
      </div>
    </div>
  );
}

export function DayCalendar(props: DayCalendarProps) {
  return (
    <Suspense fallback={<DayCalendarSkeleton />}>
      <Grid {...props} />
    </Suspense>
  );
}
