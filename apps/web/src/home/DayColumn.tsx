import type { ReactNode } from 'react';
import { spanOf, type CalendarEvent, type ConversationSummary } from '@spark-outpost/contracts';
import { clock, span } from '../calendar/calendar-format.ts';
import { ClashTag } from '../calendar/ClashTag.tsx';
import { JoinButton } from '../calendar/JoinButton.tsx';
import { countdown, overlapChat } from '../calendar/today-model.ts';
import { openTodayDay, openTodayEvent } from '../calendar/today-request.ts';
import type { Upcoming } from '../calendar/use-upcoming.ts';
import { MAC } from '../ui/shortcuts.ts';
import { HomeCard, HomeRow, HomeRows, Quiet, RowsSkeleton } from './HomeCards.tsx';
import { dayChoice } from './board-model.ts';
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
  tomorrow: boolean;
}) {
  const { event, now, day, tomorrow } = props;
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
      label={<span className="hcd">{tomorrow ? clock(start) : countdown(event, now)}</span>}
      title={event.title}
      onTitle={{ name: `Open ${event.title} in Today`, open: () => openTodayEvent(event.key) }}
      line={
        <>
          {where} <ClashTag titles={day.clashes.get(event.key)} />
          {overlap && ` · Overlaps “${overlap.title}”, still running`}
        </>
      }
      trailing={tomorrow ? undefined : <JoinButton event={event} now={now} notes />}
    />
  );
}

function Meetings(
  props: DayColumnProps & { events: readonly CalendarEvent[]; empty: string; tomorrow: boolean },
) {
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
          tomorrow={props.tomorrow}
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
  const choice = dayChoice(props.lead, props.leadEventKey, day.events, day.tomorrow);
  return (
    <HomeCard
      id="home-day"
      title={choice.title}
      action={
        <span className="hday-a">
          {!choice.tomorrow && (
            <span className="hday-hint">{MAC ? '⌘J' : 'Ctrl+J'} joins the next</span>
          )}
          <button type="button" className="hlink" onClick={openTodayDay}>
            Open Today
          </button>
        </span>
      }
    >
      <Meetings {...props} events={choice.events} empty={choice.empty} tomorrow={choice.tomorrow} />
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
