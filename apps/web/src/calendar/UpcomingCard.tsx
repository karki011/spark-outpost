import './upcoming.css';
import { useMemo } from 'react';
import { spanOf, type CalendarEvent, type ConversationSummary } from '@spark-outpost/contracts';
import { HomeSection } from '../home/HomeCards.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { MAC } from '../ui/shortcuts.ts';
import { span } from './calendar-format.ts';
import { ClashTag } from './ClashTag.tsx';
import { JoinButton } from './JoinButton.tsx';
import { countdown, overlapChat } from './today-model.ts';
import { openTodayEvent } from './today-request.ts';
import { eventEnds, stillOn, useEventClock } from './event-clock.ts';
import { useCalendarNow, useCalendarState } from './use-calendar.ts';

interface UpcomingCardProps {
  chats: readonly ConversationSummary[];
  now: number;
}

function UpcomingRow(props: {
  event: CalendarEvent;
  calendar: string;
  clashes: readonly string[] | undefined;
  now: number;
  chats: readonly ConversationSummary[];
}) {
  const { event, now } = props;
  const { start, end } = spanOf(event);
  const link = event.link;
  const overlap = overlapChat(event, now, props.chats);
  const where = [span(start, end), props.calendar, link?.host].filter(Boolean).join(' · ');
  return (
    <li className="upc">
      <span className="upc-cd">{countdown(event, now)}</span>
      <span className="upc-what">
        <button
          type="button"
          className="upc-open"
          aria-label={`Open ${event.title} in Today`}
          onClick={() => openTodayEvent(event.key)}
        >
          {event.title}
        </button>
        <small>{where}</small>
        <ClashTag titles={props.clashes} />
      </span>
      <JoinButton event={event} now={now} />
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
  const ends = useMemo(() => eventEnds(query.data?.upcoming ?? []), [query.data]);
  const clock = useEventClock(ends, query.dataUpdatedAt);
  const clashes = useMemo(
    () => new Map((query.data?.clashes ?? []).map((clash) => [clash.eventKey, clash.titles])),
    [query.data],
  );
  if (!ready || !query.data) return null;
  const upcoming = stillOn(query.data.upcoming, Math.max(now, clock));
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
              clashes={clashes.get(event.key)}
              now={now}
              chats={chats}
            />
          ))}
        </ul>
      )}
    </HomeSection>
  );
}
