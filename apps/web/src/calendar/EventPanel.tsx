import { Fragment, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CALENDAR_SERVICE_NAMES,
  isGoogleEventId,
  joinOpen,
  spanOf,
  type CalendarChoice,
  type CalendarEvent,
  type CalendarMarkKind,
} from '@spark-outpost/contracts';
import { BellIcon, BellOffIcon, ChatPlusIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { calendarApi, calendarKeys } from './calendar-api.ts';
import { CalendarName } from './CalendarName.tsx';
import { dateOf, span } from './calendar-format.ts';
import { joinHint, openJoin } from './today-model.ts';

interface EventPanelProps {
  id: string;
  event: CalendarEvent;
  date: string;
  calendars: ReadonlyMap<string, CalendarChoice>;
  isToday: boolean;
  now: number;
  onStartChat: (text: string) => void;
}

function Act(props: {
  icon: ReactNode;
  label: string;
  note: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="td-act"
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
      <small>{props.note}</small>
    </button>
  );
}

function JoinRow({ event, isToday, now }: { event: CalendarEvent; isToday: boolean; now: number }) {
  const link = event.link;
  if (!link) return null;
  const open = isToday && joinOpen(spanOf(event), now);
  const hint = isToday ? joinHint(event, now) : null;
  const host = link.unwrappedFrom
    ? `${link.host}, unwrapped from ${link.unwrappedFrom}`
    : link.host;
  const when = open ? ' · opens in your browser or app' : hint ? ` · ${hint}` : '';
  return (
    <div className="td-join">
      <button
        type="button"
        className={open ? 'btn primary sm' : 'btn line sm'}
        disabled={!open}
        onClick={() => openJoin(link.url)}
      >
        Join {CALENDAR_SERVICE_NAMES[link.service]}
      </button>
      <small>
        {host}
        {when}
      </small>
    </div>
  );
}

function useMark(event: CalendarEvent) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, on }: { kind: CalendarMarkKind; on: boolean }) =>
      calendarApi.mark({ eventKey: event.key, end: event.end, kind, on }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
  });
}

export function EventPanel({
  id,
  event,
  date,
  calendars,
  isToday,
  now,
  onStartChat,
}: EventPanelProps) {
  const mark = useMark(event);
  const occurrence = { eventId: event.id, start: event.start };
  const google = isGoogleEventId(event.id);
  const openInCalendar = useMutation({
    mutationFn: async () => {
      if (!google) return calendarApi.open(occurrence);
      const { link } = await calendarApi.detail(occurrence);
      if (!link) throw new Error('Google gave no link for this event.');
      openJoin(link);
      return { opened: true };
    },
  });
  const startChat = useMutation({
    mutationFn: () => calendarApi.detail(occurrence),
    onSuccess: (detail) => {
      const notes = detail.notes.trim();
      onStartChat(notes ? `${detail.title}\n\n${notes}` : detail.title);
    },
  });
  const { start, end } = spanOf(event);
  const pending = mark.isPending ? mark.variables : null;
  const remind = pending?.kind === 'remind_5' ? pending.on : event.remind;
  const hold = pending?.kind === 'hold' ? pending.on : event.hold;
  const ended = end <= now;
  const names = [event.calendarKey, ...event.also]
    .map((key) => calendars.get(key)?.title)
    .filter((title): title is string => Boolean(title));
  const weekday = dateOf(date).toLocaleDateString(undefined, { weekday: 'long' });
  const people = event.attendeeCount > 1 ? ` · ${event.attendeeCount} people` : '';
  const error = mark.error ?? openInCalendar.error ?? startChat.error;
  return (
    <section id={id} className="hpanel td-panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{event.title}</h2>
      <p className="td-panel-meta">
        {weekday} {span(start, end)} ·{' '}
        {names.map((name, index) => (
          <Fragment key={`${name}-${index}`}>
            {index > 0 && ' and '}
            <CalendarName name={name} className="td-panel-cal" />
          </Fragment>
        ))}
        {people}
      </p>
      <JoinRow event={event} isToday={isToday} now={now} />
      <Act
        icon={<ExternalLinkIcon />}
        label={google ? 'Open in Google Calendar' : 'Open in Calendar'}
        note={google ? 'Your browser' : 'Calendar.app'}
        onClick={() => openInCalendar.mutate()}
      />
      <Act
        icon={<ChatPlusIcon />}
        label="Start a chat for this"
        note={startChat.isPending ? 'Opening…' : 'New chat'}
        disabled={startChat.isPending}
        onClick={() => startChat.mutate()}
      />
      <Act
        icon={<BellIcon />}
        label="Remind me 5 min before"
        note={remind ? 'On' : 'Off'}
        pressed={remind}
        disabled={ended}
        onClick={() => mark.mutate({ kind: 'remind_5', on: !remind })}
      />
      <Act
        icon={<BellOffIcon />}
        label="Hold alerts during this"
        note={hold ? 'Held' : 'Off'}
        pressed={hold}
        disabled={ended}
        onClick={() => mark.mutate({ kind: 'hold', on: !hold })}
      />
      {error && (
        <p className="home-error" role="alert">
          {error.message}
        </p>
      )}
      <p className="td-hint">Reminders and holds live in Spark; they don’t change the event.</p>
    </section>
  );
}
