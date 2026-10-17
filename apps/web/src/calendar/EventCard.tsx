import type { CSSProperties, MouseEvent } from 'react';
import {
  CALENDAR_SERVICE_NAMES,
  joinOpen,
  spanOf,
  type CalendarChoice,
  type CalendarEvent,
} from '@spark-outpost/contracts';
import { VideoIcon } from '../ui/icons.tsx';
import { clock, duration, span } from './calendar-format.ts';
import { swatch } from './CalendarAccounts.tsx';
import { ClashTag } from './ClashTag.tsx';
import { JoinButton } from './JoinButton.tsx';
import { durationMinutes, initials, isPastEvent } from './month-model.ts';
import { notesSnippet, peopleLine } from './event-text.ts';
import { joinHint } from './today-model.ts';
import { useEventDetail } from './use-calendar.ts';

const FACES_SHOWN = 3;

function People({ names, count }: { names: readonly string[]; count: number }) {
  const line = peopleLine(names, count);
  if (!line) return null;
  return (
    <p className="rl-people">
      {names.length > 0 && (
        <span className="rl-faces" aria-hidden="true">
          {names.slice(0, FACES_SHOWN).map((name, index) => (
            <i key={`${name}-${index}`}>{initials(name)}</i>
          ))}
        </span>
      )}
      <span>{line}</span>
    </p>
  );
}

function VideoChip({
  event,
  now,
  isToday,
}: {
  event: CalendarEvent;
  now: number;
  isToday: boolean;
}) {
  const link = event.link;
  if (!link) return null;
  const service = CALENDAR_SERVICE_NAMES[link.service];
  if (joinOpen(spanOf(event), now)) {
    return <JoinButton event={event} now={now} label={`Join ${service}`} className="rl-join" />;
  }
  const hint = isToday ? joinHint(event, now) : null;
  return (
    <p className="rl-video">
      <span className="rl-chip">
        <VideoIcon />
        {service}
      </span>
      {hint && <small>Join opens {hint}</small>}
    </p>
  );
}

interface EventCardProps {
  event: CalendarEvent;
  calendar: CalendarChoice | undefined;
  clashes: readonly string[] | undefined;
  now: number;
  isToday: boolean;
  onOpen: (event: CalendarEvent, anchor: HTMLElement) => void;
}

export function EventCard({ event, calendar, clashes, now, isToday, onOpen }: EventCardProps) {
  const detail = useEventDetail(event);
  const { start, end } = spanOf(event);
  const notes = detail.data ? notesSnippet(detail.data.notes) : '';
  const past = isPastEvent(event, now);
  const when = event.allDay ? 'All day' : span(start, end);
  const length = event.allDay ? null : duration(durationMinutes(event));
  return (
    <li
      className="rl-card"
      data-past={past || undefined}
      data-focus={event.focus || undefined}
      data-free={!event.busy || undefined}
      style={swatch(calendar?.color ?? '') as CSSProperties}
    >
      <span className="rl-strip" aria-hidden="true" />
      <button
        type="button"
        className="rl-open"
        aria-haspopup="dialog"
        aria-label={`${event.title}, ${when}${calendar ? `, ${calendar.title}` : ''}${past ? ', ended' : ''}`}
        onClick={(click: MouseEvent<HTMLButtonElement>) => onOpen(event, click.currentTarget)}
      >
        {event.title}
      </button>
      {notes && <p className="rl-notes">{notes}</p>}
      <p className="rl-time">
        <span>{event.allDay ? 'All day' : `${clock(start)} – ${clock(end)}`}</span>
        {length && <span>{length}</span>}
      </p>
      {clashes && (
        <p className="rl-tags">
          <ClashTag titles={clashes} />
        </p>
      )}
      <People names={detail.data?.attendees ?? []} count={event.attendeeCount} />
      <VideoChip event={event} now={now} isToday={isToday} />
    </li>
  );
}
