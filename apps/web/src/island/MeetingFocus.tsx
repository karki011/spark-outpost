import { useEffect, useRef } from 'react';
import {
  CALENDAR_SERVICE_NAMES,
  joinOpen,
  spanOf,
  type CalendarEvent,
} from '@spark-outpost/contracts';
import { span } from '../calendar/calendar-format.ts';
import { joinLabel } from '../calendar/meeting-card.ts';
import { MeetingChoices } from '../calendar/MeetingChoices.tsx';
import { ClashTag } from '../calendar/ClashTag.tsx';
import { openJoin } from '../calendar/today-model.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { ExternalLinkIcon, VideoIcon } from '../ui/icons.tsx';
import { afterMeeting, leadProgress, startsIn } from './home-model.ts';
import { Kbd } from './island-parts.tsx';
import { JoinAtStartAction } from './JoinAtStartAction.tsx';

interface MeetingProps {
  calendar: IslandCalendar;
}

function canJoin(event: CalendarEvent, calendar: IslandCalendar): boolean {
  return event.link !== null && joinOpen(spanOf(event), calendar.at, calendar.joinLeadMs);
}

function join(event: CalendarEvent, calendar: IslandCalendar): void {
  if (!event.link) return;
  openJoin(event.link.url);
  calendar.onJoined(event.key);
}

function useJoinKey(event: CalendarEvent | null, calendar: IslandCalendar) {
  const latest = useRef({ event, calendar });
  useEffect(() => {
    latest.current = { event, calendar };
  });
  const on = event !== null;
  useEffect(() => {
    if (!on) return;
    const onKeyDown = (key: KeyboardEvent) => {
      if (!key.metaKey || key.shiftKey || key.altKey || key.key.toLowerCase() !== 'j') return;
      const shown = latest.current;
      if (!shown.event || !canJoin(shown.event, shown.calendar)) return;
      key.preventDefault();
      join(shown.event, shown.calendar);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [on]);
}

function DateTile({ event }: { event: CalendarEvent }) {
  const start = new Date(spanOf(event).start);
  return (
    <span className="isl-date" aria-hidden="true">
      <span className="isl-date-month">
        {start.toLocaleDateString(undefined, { month: 'short' })}
      </span>
      <span className="isl-date-day">{start.getDate()}</span>
    </span>
  );
}

function JoinNow({
  event,
  calendar,
  shortcut,
  compact,
}: { event: CalendarEvent; shortcut?: boolean; compact?: boolean } & MeetingProps) {
  if (!canJoin(event, calendar)) return null;
  return (
    <button
      type="button"
      className={compact ? 'isl-btn primary' : 'isl-btn big primary'}
      aria-label={`${joinLabel(event)}: ${event.title}`}
      onClick={() => join(event, calendar)}
    >
      Join {shortcut && <Kbd>⌘J</Kbd>}
    </button>
  );
}

function OneMeeting({ event, calendar }: { event: CalendarEvent } & MeetingProps) {
  const { start, end } = spanOf(event);
  const next = afterMeeting(calendar.upcoming, event);
  useJoinKey(event, calendar);
  return (
    <article className="isl-focus isl-meet" aria-label={`Meeting: ${event.title}`}>
      <div className="isl-focus-who">
        <DateTile event={event} />
        <b className="isl-focus-chat">{event.title}</b>
        <span className="isl-focus-sub">{calendar.calendarName(event)}</span>
      </div>
      <div className="isl-focus-body">
        <p className="isl-meet-when">
          <b>{startsIn(event, calendar.at)}</b>
          <span>{span(start, end)}</span>
        </p>
        <p className="isl-meet-facts">
          {event.link && (
            <span className="isl-meet-service">
              <VideoIcon />
              {CALENDAR_SERVICE_NAMES[event.link.service]}
            </span>
          )}
          {event.attendeeCount > 1 && <span>{event.attendeeCount} people</span>}
          {next && <span>Next: {next.title}</span>}
        </p>
        <div className="isl-meet-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${leadProgress(event, calendar.at)})` }} />
        </div>
        <div className="isl-focus-acts">
          <JoinNow event={event} calendar={calendar} shortcut />
          <JoinAtStartAction
            event={event}
            calendar={calendar}
            buttonClass="isl-btn big"
            noteClass="isl-meet-later"
            offer={false}
          />
          <button
            type="button"
            className="isl-btn big"
            onClick={() => calendar.onSnoozeAlert(event)}
          >
            Snooze 1 min
          </button>
          <button
            type="button"
            className="isl-btn big deny"
            onClick={() => calendar.onDismissNudge(event)}
          >
            Dismiss
          </button>
          <span className="isl-sp" />
          <button
            type="button"
            className="isl-focus-open"
            onClick={() => calendar.onOpenEvent(event.key)}
          >
            Open Today <ExternalLinkIcon />
          </button>
        </div>
      </div>
    </article>
  );
}

function ClashMeetings({ events, calendar }: { events: readonly CalendarEvent[] } & MeetingProps) {
  const first = events[0]!;
  return (
    <section className="isl-focus isl-meet" aria-label="Choose a meeting">
      <div className="isl-focus-who">
        <DateTile event={first} />
        <b className="isl-focus-chat">{events.length} meetings</b>
        <span className="isl-focus-sub">{startsIn(first, calendar.at)}</span>
      </div>
      <div className="isl-focus-body">
        <h3 className="isl-focus-title">
          Which one are you joining? <ClashTag titles={events.slice(1).map((e) => e.title)} />
        </h3>
        <MeetingChoices
          meetings={events}
          now={calendar.at}
          calendarName={calendar.calendarName}
          onOpen={(event) => calendar.onOpenEvent(event.key)}
          onJoined={(event) => calendar.onJoined(event.key)}
          buttonClass={{ join: 'isl-btn big primary', open: 'isl-btn big' }}
          focusFirst
        />
        <div className="isl-focus-acts">
          <button
            type="button"
            className="isl-btn big"
            onClick={() => events.forEach((event) => calendar.onSnoozeAlert(event))}
          >
            Snooze all
          </button>
          <button
            type="button"
            className="isl-btn big deny"
            onClick={() => events.forEach((event) => calendar.onDismissNudge(event))}
          >
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}

export function MeetingFocus({
  events,
  calendar,
}: { events: readonly CalendarEvent[] } & MeetingProps) {
  if (events.length > 1) return <ClashMeetings events={events} calendar={calendar} />;
  return events[0] ? <OneMeeting event={events[0]} calendar={calendar} /> : null;
}

export function MeetingStrip({ event, calendar }: { event: CalendarEvent } & MeetingProps) {
  const { start, end } = spanOf(event);
  return (
    <section className="isl-meetstrip" aria-label="Next meeting">
      <VideoIcon />
      <button
        type="button"
        className="isl-meetstrip-text"
        onClick={() => calendar.onOpenEvent(event.key)}
      >
        <b>
          {event.title} {startsIn(event, calendar.at)}
        </b>
        <span>
          {span(start, end)}
          {event.link ? ` · ${CALENDAR_SERVICE_NAMES[event.link.service]}` : ''}
        </span>
      </button>
      <ClashTag titles={calendar.clashes.get(event.key)} />
      <JoinNow event={event} calendar={calendar} />
      <button type="button" className="isl-btn big" onClick={() => calendar.onSnooze(event)}>
        Snooze
      </button>
    </section>
  );
}

export function TodayMeetings({ calendar }: MeetingProps) {
  const meetings = calendar.upcoming.slice(0, 4);
  if (meetings.length === 0) return null;
  return (
    <ul className="isl-meet-rows" aria-label="Meetings left today">
      {meetings.map((event, index) => {
        const { start } = spanOf(event);
        return (
          <li key={event.key} className="isl-meet-row">
            <button
              type="button"
              className="isl-meet-row-text"
              onClick={() => calendar.onOpenEvent(event.key)}
            >
              <b>{event.title}</b>
              <span>
                {span(start, spanOf(event).end)}
                {index === 0 ? ` · ${startsIn(event, calendar.at)}` : ''}
              </span>
            </button>
            <ClashTag titles={calendar.clashes.get(event.key)} />
            {index === 0 && <JoinNow event={event} calendar={calendar} compact />}
          </li>
        );
      })}
    </ul>
  );
}
