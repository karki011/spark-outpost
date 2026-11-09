import './calendar-parts.css';
import { useEffect, useRef } from 'react';
import { joinOpen, spanOf, type CalendarEvent } from '@spark-outpost/contracts';
import { clock } from './calendar-format.ts';
import { openJoin } from './today-model.ts';
import { useJoinLeadMs } from './use-calendar.ts';

interface MeetingChoicesProps {
  meetings: readonly CalendarEvent[];
  now: number;
  calendarName: (event: CalendarEvent) => string;
  onOpen: (event: CalendarEvent) => void;
  onJoined?: ((event: CalendarEvent) => void) | undefined;
  buttonClass: { join: string; open: string };
  focusFirst?: boolean;
}

function ChoiceAction(props: {
  event: CalendarEvent;
  now: number;
  onOpen: (event: CalendarEvent) => void;
  onJoined?: ((event: CalendarEvent) => void) | undefined;
  buttonClass: { join: string; open: string };
}) {
  const { event } = props;
  const leadMs = useJoinLeadMs();
  const link = event.link;
  if (link && joinOpen(spanOf(event), props.now, leadMs)) {
    return (
      <button
        type="button"
        className={props.buttonClass.join}
        aria-label={`Join ${event.title}`}
        onClick={() => {
          openJoin(link.url);
          props.onJoined?.(event);
        }}
      >
        Join
      </button>
    );
  }
  return (
    <button
      type="button"
      className={props.buttonClass.open}
      aria-label={`Open ${event.title}`}
      onClick={() => props.onOpen(event)}
    >
      Open
    </button>
  );
}

export function MeetingChoices(props: MeetingChoicesProps) {
  const list = useRef<HTMLUListElement>(null);
  const { focusFirst = false } = props;
  useEffect(() => {
    if (focusFirst) list.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [focusFirst]);
  return (
    <ul ref={list} className="cal-choices">
      {props.meetings.map((event) => (
        <li key={event.key} className="cal-choice">
          <span className="cal-choice-text" title={event.title}>
            <time>{clock(spanOf(event).start)}</time>
            <b>{event.title}</b>
            <small>{props.calendarName(event)}</small>
          </span>
          <ChoiceAction
            event={event}
            now={props.now}
            onOpen={props.onOpen}
            onJoined={props.onJoined}
            buttonClass={props.buttonClass}
          />
        </li>
      ))}
    </ul>
  );
}
