import type { CalendarChoice, CalendarWeekDay } from '@spark-outpost/contracts';
import { countLabel } from '../ui/count-label.ts';
import { weekdayShort } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { CalendarName } from './CalendarName.tsx';

interface WeekStripProps {
  week: readonly CalendarWeekDay[];
  date: string;
  onPick: (date: string) => void;
}

export function WeekStrip({ week, date, onPick }: WeekStripProps) {
  return (
    <div className="td-week" role="group" aria-label="This week">
      {week.map((day) => (
        <button
          key={day.date}
          type="button"
          className="td-day"
          aria-pressed={day.date === date}
          onClick={() => onPick(day.date)}
        >
          <b>{weekdayShort(day.date)}</b>
          <span>{day.meetings > 0 ? countLabel(day.meetings, 'meeting') : 'free'}</span>
        </button>
      ))}
    </div>
  );
}

interface CalendarFiltersProps {
  calendars: readonly CalendarChoice[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

export function CalendarFilters({ calendars, hidden, onToggle }: CalendarFiltersProps) {
  const included = calendars.filter((calendar) => calendar.include);
  if (included.length < 2) return null;
  return (
    <div className="td-filters" role="group" aria-label="Show calendars">
      {included.map((calendar) => (
        <button
          key={calendar.key}
          type="button"
          className="td-filter"
          aria-pressed={!hidden.has(calendar.key)}
          onClick={() => onToggle(calendar.key)}
        >
          <i className="cal-sw" style={swatch(calendar.color)} aria-hidden="true" />
          <CalendarName name={calendar.title} />
        </button>
      ))}
    </div>
  );
}
