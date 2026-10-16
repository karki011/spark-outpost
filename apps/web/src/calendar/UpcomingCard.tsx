import './upcoming.css';
import { useMemo } from 'react';
import {
  joinOpen,
  JOIN_LEAD_MS,
  spanOf,
  type CalendarEvent,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { HomeSection } from '../home/HomeCards.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { MAC } from '../ui/shortcuts.ts';
import { clock, span } from './calendar-format.ts';
import { countdown, openJoin, overlapChat } from './today-model.ts';
import { useCalendarNow, useCalendarState } from './use-calendar.ts';

interface UpcomingCardProps {
  chats: readonly ConversationSummary[];
  now: number;
}

function UpcomingRow(props: {
  event: CalendarEvent;
  calendar: string;
  now: number;
  chats: readonly ConversationSummary[];
}) {
  const { event, now } = props;
  const { start, end } = spanOf(event);
  const link = event.link;
  const open = link !== null && joinOpen({ start, end }, now);
  const overlap = overlapChat(event, now, props.chats);
  const where = [span(start, end), props.calendar, link?.host].filter(Boolean).join(' · ');
  return (
    <li className="upc">
      <span className="upc-cd">{countdown(event, now)}</span>
      <span className="upc-what">
        <b>{event.title}</b>
        <small>{where}</small>
      </span>
      {link && (
        <button
          type="button"
          className={open ? 'btn primary sm' : 'btn line sm'}
          disabled={!open}
          title={open ? undefined : `From ${clock(start - JOIN_LEAD_MS)}`}
          aria-label={`Join ${event.title}`}
          onClick={() => openJoin(link.url)}
        >
          Join
        </button>
      )}
      {overlap && <span className="upc-ov">Overlaps “{overlap.title}”, still running</span>}
    </li>
  );
}

export function UpcomingCard({ chats, now }: UpcomingCardProps) {
  const { remote } = useRemoteClient();
  const { state } = useCalendarState();
  const ready = !remote && state === 'ready';
  const query = useCalendarNow(ready);
  const calendars = useMemo(
    () => new Map((query.data?.calendars ?? []).map((choice) => [choice.key, choice.title])),
    [query.data],
  );
  if (!ready || !query.data) return null;
  const upcoming = query.data.upcoming;
  return (
    <HomeSection
      id="home-upcoming"
      title="Upcoming"
      action={<span className="upc-hint">{MAC ? '⌘J' : 'Ctrl+J'} joins the next</span>}
    >
      {upcoming.length === 0 ? (
        <p className="hquiet">No more meetings today.</p>
      ) : (
        <ul className="upc-list">
          {upcoming.map((event) => (
            <UpcomingRow
              key={event.key}
              event={event}
              calendar={calendars.get(event.calendarKey) ?? 'Calendar'}
              now={now}
              chats={chats}
            />
          ))}
        </ul>
      )}
    </HomeSection>
  );
}
