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
import { ClashTag } from './ClashTag.tsx';
import { dateOf, span } from './calendar-format.ts';
import { EventInfo } from './EventDetails.tsx';
import { JoinButton } from './JoinButton.tsx';
import { TakeNotesButton } from '../meetings/index.ts';
import { replyState } from './reply-status.ts';
import { openJoin } from './today-model.ts';
import { openTodayMeeting } from './today-request.ts';
import { useJoinLeadMs } from './use-calendar.ts';

interface EventPanelProps {
  id: string;
  event: CalendarEvent;
  date: string;
  calendars: ReadonlyMap<string, CalendarChoice>;
  clashes?: readonly string[] | undefined;
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

function JoinRow({
  event,
  now,
  calendarName,
}: {
  event: CalendarEvent;
  now: number;
  calendarName: string | undefined;
}) {
  const leadMs = useJoinLeadMs();
  const link = event.link;
  if (!link) return null;
  const open = joinOpen(spanOf(event), now, leadMs);
  const host = link.unwrappedFrom
    ? `${link.host}, unwrapped from ${link.unwrappedFrom}`
    : link.host;
  return (
    <div className="td-join">
      <JoinButton
        event={event}
        now={now}
        label={`Join ${CALENDAR_SERVICE_NAMES[link.service]}`}
        early="subtle"
        notes
        calendarName={calendarName}
      />
      <small>
        {host}
        {open && ' · opens in your browser or app'}
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

interface EventMetaProps {
  event: CalendarEvent;
  date: string;
  calendars: ReadonlyMap<string, CalendarChoice>;
}

export function EventMeta({ event, date, calendars }: EventMetaProps) {
  const { start, end } = spanOf(event);
  const names = [event.calendarKey, ...event.also]
    .map((key) => calendars.get(key)?.title)
    .filter((title): title is string => Boolean(title));
  const weekday = dateOf(date).toLocaleDateString(undefined, { weekday: 'long' });
  const people = event.attendeeCount > 1 ? ` · ${event.attendeeCount} people` : '';
  const reply = replyState(event.myStatus);
  return (
    <>
      <p className="td-panel-meta">
        {weekday} {event.allDay ? 'all day' : span(start, end)} ·{' '}
        {names.map((name, index) => (
          <Fragment key={`${name}-${index}`}>
            {index > 0 && ' and '}
            <CalendarName name={name} className="td-panel-cal" />
          </Fragment>
        ))}
        {people}
      </p>
      {reply.word && (
        <p className="td-panel-reply" data-reply={reply.look}>
          <i aria-hidden="true" />
          <span className="sr-only">Your reply: </span>
          {reply.word}
        </p>
      )}
    </>
  );
}

interface EventActionsProps {
  event: CalendarEvent;
  calendarName?: string | undefined;
  now: number;
  onStartChat: (text: string) => void;
}

export function EventActions({ event, calendarName, now, onStartChat }: EventActionsProps) {
  const mark = useMark(event);
  const occurrence = { eventId: event.id, start: event.start, calendarKey: event.calendarKey };
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
  const pending = mark.isPending ? mark.variables : null;
  const remind = pending?.kind === 'remind_5' ? pending.on : event.remind;
  const hold = pending?.kind === 'hold' ? pending.on : event.hold;
  const ended = spanOf(event).end <= now;
  const error = mark.error ?? openInCalendar.error ?? startChat.error;
  return (
    <>
      <JoinRow event={event} now={now} calendarName={calendarName} />
      {!event.allDay && !ended && (
        <TakeNotesButton
          title={event.title}
          eventKey={event.key}
          calendarName={calendarName}
          onStarted={(meeting) => openTodayMeeting(meeting.id)}
        />
      )}
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
    </>
  );
}

export function EventPanel({
  id,
  event,
  date,
  calendars,
  clashes,
  now,
  onStartChat,
}: EventPanelProps) {
  return (
    <section id={id} className="hpanel td-panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{event.title}</h2>
      <EventMeta event={event} date={date} calendars={calendars} />
      {clashes && (
        <p className="td-panel-clash">
          <ClashTag titles={clashes} />
        </p>
      )}
      <EventInfo event={event} now={now} />
      <EventActions
        event={event}
        calendarName={calendars.get(event.calendarKey)?.title}
        now={now}
        onStartChat={onStartChat}
      />
    </section>
  );
}
