import './rail.css';
import { useId, useMemo } from 'react';
import {
  CALENDAR_FREE_MIN_MS,
  freeBlocks,
  type CalendarChoice,
  type CalendarEvent,
  type CalendarSpan,
} from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { dateOf, span } from './calendar-format.ts';
import { EventCard } from './EventCard.tsx';
import { dayStartOf, shiftDay, timeGroups, type TimeGroup } from './month-model.ts';

interface ScheduledRailProps {
  date: string;
  today: string;
  now: number;
  events: readonly CalendarEvent[];
  calendars: ReadonlyMap<string, CalendarChoice>;
  clashes: ReadonlyMap<string, readonly string[]>;
  loading: boolean;
  onDate: (date: string) => void;
  onOpenDay: (date: string) => void;
  onOpenEvent: (event: CalendarEvent, anchor: HTMLElement) => void;
}

type RailItem =
  | { kind: 'group'; at: number; group: TimeGroup }
  | { kind: 'free'; at: number; free: CalendarSpan };

const FREE_FIRST = 0.5;

function railItems(groups: readonly TimeGroup[], free: readonly CalendarSpan[]): RailItem[] {
  const items: RailItem[] = [
    ...groups.map((group) => ({
      kind: 'group' as const,
      at: group.label === 'All day' ? -Infinity : Date.parse(group.events[0]!.start),
      group,
    })),
    ...free.map((block) => ({ kind: 'free' as const, at: block.start - FREE_FIRST, free: block })),
  ];
  return items.toSorted((a, b) => a.at - b.at);
}

function upcomingFree(blocks: readonly CalendarSpan[], now: number): CalendarSpan[] {
  return blocks.flatMap((block) => {
    const start = Math.max(block.start, now);
    return block.end - start >= CALENDAR_FREE_MIN_MS ? [{ start, end: block.end }] : [];
  });
}

function railDate(date: string): string {
  return dateOf(date).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function ScheduledRail(props: ScheduledRailProps) {
  const { date, today, now, events, calendars, clashes } = props;
  const headingId = useId();
  const isToday = date === today;
  const items = useMemo(() => {
    const free = date >= today ? upcomingFree(freeBlocks([...events], dayStartOf(date)), now) : [];
    return railItems(timeGroups(events, date), free);
  }, [events, date, today, now]);
  return (
    <aside className="hpanel rl" aria-labelledby={headingId}>
      <header className="rl-head">
        <div>
          <h2 id={headingId}>Scheduled</h2>
          <p className="td-sub" aria-live="polite">
            {railDate(date)}
          </p>
        </div>
        <span className="rl-nav">
          <button
            type="button"
            className="mo-step"
            aria-label="Previous day"
            onClick={() => props.onDate(shiftDay(date, -1))}
          >
            <span className="mo-back">
              <ChevronIcon />
            </span>
          </button>
          <button
            type="button"
            className="mo-step"
            aria-label="Next day"
            onClick={() => props.onDate(shiftDay(date, 1))}
          >
            <ChevronIcon />
          </button>
        </span>
      </header>
      <button type="button" className="btn line sm rl-day" onClick={() => props.onOpenDay(date)}>
        Open in Day view
      </button>
      {props.loading && <Skeleton label="Loading events" shape="cards" rows={2} />}
      {!props.loading && events.length === 0 && (
        <p className="hquiet rl-quiet">Nothing scheduled.</p>
      )}
      {items.map((item) =>
        item.kind === 'free' ? (
          <p key={`free-${item.free.start}`} className="rl-free">
            free {span(item.free.start, item.free.end)}
          </p>
        ) : (
          <section key={item.group.label} className="rl-group" aria-label={item.group.label}>
            <h3 className="rl-hour">{item.group.label}</h3>
            <ul className="rl-cards">
              {item.group.events.map((event) => (
                <EventCard
                  key={event.key}
                  event={event}
                  calendar={calendars.get(event.calendarKey)}
                  clashes={clashes.get(event.key)}
                  now={now}
                  isToday={isToday}
                  onOpen={props.onOpenEvent}
                />
              ))}
            </ul>
          </section>
        ),
      )}
    </aside>
  );
}
