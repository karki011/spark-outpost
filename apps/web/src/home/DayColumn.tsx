import type { ReactNode } from 'react';
import { spanOf, type CalendarEvent, type ConversationSummary } from '@spark-outpost/contracts';
import { span } from '../calendar/calendar-format.ts';
import { ClashTag } from '../calendar/ClashTag.tsx';
import { JoinButton } from '../calendar/JoinButton.tsx';
import { countdown, overlapChat } from '../calendar/today-model.ts';
import { openTodayDay, openTodayEvent } from '../calendar/today-request.ts';
import type { Upcoming } from '../calendar/use-upcoming.ts';
import { MAC } from '../ui/shortcuts.ts';
import { HomeCard, HomeRow, HomeRows, Quiet, RowsSkeleton } from './HomeCards.tsx';
import { dayTitle, splitDays } from './board-model.ts';
import type { LeadState } from './lead-state.ts';
import { ProviderNotice } from './ProviderNotice.tsx';
import { SpendLine } from './SpendLine.tsx';

interface DayColumnProps {
  day: Upcoming;
  lead: LeadState;
  leadEventKey: string | null;
  chats: readonly ConversationSummary[];
  now: number;
  recap: ReactNode;
  onUsage: () => void;
  onProviders: () => void;
}

function DayRow(props: {
  event: CalendarEvent;
  index: number;
  day: Upcoming;
  now: number;
  chats: readonly ConversationSummary[];
}) {
  const { event, now, day } = props;
  const { start, end } = spanOf(event);
  const overlap = overlapChat(event, now, props.chats);
  const where = [
    span(start, end),
    day.calendars.get(event.calendarKey) ?? 'Calendar',
    event.link?.host,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <HomeRow
      index={props.index}
      label={<span className="hcd">{countdown(event, now)}</span>}
      title={event.title}
      onTitle={{ name: `Open ${event.title} in Today`, open: () => openTodayEvent(event.key) }}
      line={
        <>
          {where} <ClashTag titles={day.clashes.get(event.key)} />
          {overlap && ` · Overlaps “${overlap.title}”, still running`}
        </>
      }
      trailing={<JoinButton event={event} now={now} />}
    />
  );
}

function Meetings(props: DayColumnProps & { events: readonly CalendarEvent[]; empty: string }) {
  if (props.events.length === 0) return <Quiet>{props.empty}</Quiet>;
  return (
    <HomeRows label="Meetings">
      {props.events.map((event, index) => (
        <DayRow
          key={event.key}
          event={event}
          index={index}
          day={props.day}
          now={props.now}
          chats={props.chats}
        />
      ))}
    </HomeRows>
  );
}

function CalendarCard(props: DayColumnProps) {
  const { day } = props;
  if (day.pending) {
    return (
      <HomeCard id="home-day" title="Your day" busy>
        <RowsSkeleton />
      </HomeCard>
    );
  }
  if (!day.available) return null;
  const days = splitDays(day.events, props.now, props.leadEventKey);
  const evening = props.lead === 'before-you-go' && days.tomorrow.length > 0;
  return (
    <HomeCard
      id="home-day"
      title={dayTitle(props.lead, days.tomorrow.length > 0)}
      action={
        <span className="hday-a">
          <span className="hday-hint">{MAC ? '⌘J' : 'Ctrl+J'} joins the next</span>
          <button type="button" className="hlink" onClick={openTodayDay}>
            Open Today
          </button>
        </span>
      }
    >
      {evening ? (
        <Meetings {...props} events={days.tomorrow.slice(0, 3)} empty="" />
      ) : (
        <Meetings {...props} events={days.today} empty="No more meetings today." />
      )}
    </HomeCard>
  );
}

export function DayColumn(props: DayColumnProps) {
  return (
    <div className="hcol">
      <CalendarCard {...props} />
      {props.recap}
      <div className="hfoot">
        <SpendLine onUsage={props.onUsage} />
        <ProviderNotice onSettings={props.onProviders} />
      </div>
    </div>
  );
}
