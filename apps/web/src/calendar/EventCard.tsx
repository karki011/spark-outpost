import type { CSSProperties, MouseEvent } from 'react';
import {
  CALENDAR_SERVICE_NAMES,
  spanOf,
  type CalendarChoice,
  type CalendarEvent,
} from '@spark-outpost/contracts';
import { VideoIcon } from '../ui/icons.tsx';
import { duration, span } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { ClashTag } from './ClashTag.tsx';
import { JoinButton } from './JoinButton.tsx';
import { Attendees, EventLocation } from './EventDetails.tsx';
import { durationMinutes } from './month-model.ts';
import { replyState } from './reply-status.ts';
import { useEventDetail } from './use-calendar.ts';

const PEOPLE_SHOWN = 2;

function VideoChip({ event, now }: { event: CalendarEvent; now: number }) {
  const link = event.link;
  if (!link) return null;
  const service = CALENDAR_SERVICE_NAMES[link.service];
  if (spanOf(event).end > now) {
    return (
      <JoinButton
        event={event}
        now={now}
        label={`Join ${service}`}
        className="rl-join"
        early="subtle"
        notes
      />
    );
  }
  return (
    <p className="rl-video">
      <span className="rl-chip">
        <VideoIcon />
        {service}
      </span>
    </p>
  );
}

interface EventCardProps {
  event: CalendarEvent;
  calendar: CalendarChoice | undefined;
  clashes: readonly string[] | undefined;
  now: number;
  selected: boolean;
  onOpen: (event: CalendarEvent, anchor: HTMLElement) => void;
}

export function EventCard(props: EventCardProps) {
  const { event, calendar, clashes, now, onOpen } = props;
  const detail = useEventDetail(event);
  const reply = replyState(event.myStatus);
  const { start, end } = spanOf(event);
  const notes = detail.data?.snippet ?? '';
  const past = end <= now;
  const when = event.allDay ? 'All day' : span(start, end);
  const length = event.allDay ? null : duration(durationMinutes(event));
  return (
    <li
      className="rl-card"
      data-past={past || undefined}
      data-selected={props.selected || undefined}
      data-focus={event.focus || undefined}
      data-free={!event.busy || undefined}
      data-reply={reply.look}
      style={swatch(calendar?.color ?? '') as CSSProperties}
    >
      <span className="rl-strip" aria-hidden="true" />
      <button
        type="button"
        className="rl-open"
        aria-haspopup="dialog"
        aria-expanded={props.selected}
        aria-label={`${event.title}, ${when}${calendar ? `, ${calendar.title}` : ''}${past ? ', ended' : ''}${reply.word ? `, ${reply.word}` : ''}`}
        onClick={(click: MouseEvent<HTMLButtonElement>) => onOpen(event, click.currentTarget)}
      >
        {event.title}
      </button>
      {notes && <p className="rl-notes">{notes}</p>}
      <p className="rl-time">
        <span>{when}</span>
        {length && <span>{length}</span>}
      </p>
      <EventLocation location={detail.data?.location ?? null} event={event} now={now} />
      {clashes && (
        <p className="rl-tags">
          <ClashTag titles={clashes} />
        </p>
      )}
      <div className="rl-people">
        <Attendees
          people={detail.data?.attendees ?? []}
          count={event.attendeeCount}
          shown={PEOPLE_SHOWN}
        />
      </div>
      <VideoChip event={event} now={now} />
    </li>
  );
}
