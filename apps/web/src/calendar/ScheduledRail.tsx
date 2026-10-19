import './rail.css';
import { useId, useMemo, type CSSProperties } from 'react';
import {
  CALENDAR_FREE_MIN_MS,
  freeBlocks,
  type CalendarChoice,
  type CalendarEvent,
  type CalendarSpan,
} from '@spark-outpost/contracts';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { PanelResizer } from '../ui/PanelResizer.tsx';
import type { PanelWidthLimits } from '../ui/panel-width.ts';
import { dateOf, shortDay, span } from './calendar-format.ts';
import { EventCard } from './EventCard.tsx';
import { StepButtons } from './StepButtons.tsx';
import { shiftDay } from './month-model.ts';

interface ScheduledRailProps {
  date: string;
  today: string;
  now: number;
  events: readonly CalendarEvent[];
  calendars: ReadonlyMap<string, CalendarChoice>;
  clashes: ReadonlyMap<string, readonly string[]>;
  loading: boolean;
  selected: string | null;
  width: number | null;
  onWidth: (width: number | null) => void;
  onDate: (date: string) => void;
  onOpenDay: (date: string) => void;
  onOpenEvent: (event: CalendarEvent, anchor: HTMLElement) => void;
}

type RailItem =
  | { kind: 'event'; at: number; event: CalendarEvent }
  | { kind: 'free'; at: number; free: CalendarSpan };

const FREE_FIRST = 0.5;

export const RAIL_WIDTH: PanelWidthLimits = {
  key: 'spark-outpost.calendar.day-panel.width',
  min: 280,
  max: 640,
  fallback: 352,
};

function railItems(events: readonly CalendarEvent[], free: readonly CalendarSpan[]): RailItem[] {
  const items: RailItem[] = [
    ...events.map((event) => ({
      kind: 'event' as const,
      at: event.allDay ? -Infinity : Date.parse(event.start),
      event,
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

export function ScheduledRail(props: ScheduledRailProps) {
  const { date, today, now, events, calendars, clashes } = props;
  const headingId = useId();
  const isToday = date === today;
  const items = useMemo(() => {
    const free =
      date >= today ? upcomingFree(freeBlocks([...events], dateOf(date).getTime()), now) : [];
    return railItems(events, free);
  }, [events, date, today, now]);
  const shownWidth = { '--rl-w': `${props.width ?? RAIL_WIDTH.fallback}px` } as CSSProperties;
  return (
    <div className="rl-wrap" style={shownWidth}>
      <PanelResizer
        className="rl-resize"
        label="Resize day panel"
        panelSelector=".rl-wrap"
        variable="--rl-w"
        cap="--rl-cap"
        side="left"
        limits={RAIL_WIDTH}
        width={props.width}
        onWidth={props.onWidth}
      />
      <aside className="rl" aria-label="Scheduled">
        <header className="rl-head">
          <h2 id={headingId} aria-live="polite">
            {shortDay(date)}
          </h2>
          <span className="rl-nav">
            <StepButtons unit="day" onStep={(delta) => props.onDate(shiftDay(date, delta))} />
          </span>
        </header>
        {props.loading && <Skeleton label="Loading events" shape="cards" rows={2} />}
        {!props.loading && events.length === 0 && (
          <p className="hquiet rl-quiet">Nothing scheduled.</p>
        )}
        <ul className="rl-cards" aria-labelledby={headingId}>
          {items.map((item) =>
            item.kind === 'free' ? (
              <li key={`free-${item.free.start}`} className="rl-free">
                free {span(item.free.start, item.free.end)}
              </li>
            ) : (
              <EventCard
                key={item.event.key}
                event={item.event}
                calendar={calendars.get(item.event.calendarKey)}
                clashes={clashes.get(item.event.key)}
                now={now}
                isToday={isToday}
                selected={item.event.key === props.selected}
                onOpen={props.onOpenEvent}
              />
            ),
          )}
        </ul>
        <button type="button" className="rl-day" onClick={() => props.onOpenDay(date)}>
          Open in Day view
        </button>
      </aside>
    </div>
  );
}
