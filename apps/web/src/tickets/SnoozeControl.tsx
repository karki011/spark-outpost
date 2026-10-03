import './snooze.css';
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SNOOZE_MAX_DAYS, type InboxTicket, type TicketInbox } from '@spark-outpost/contracts';
import { DayCalendar } from '../ui/DayCalendar.tsx';
import { BackIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';
import { Glyph } from './ticket-icons.tsx';
import { morningOf, snoozeChoices, snoozeTime } from './ticket-model.ts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

function addDays(day: Date, days: number): Date {
  const next = new Date(day);
  next.setDate(next.getDate() + days);
  return next;
}

function snoozedLocally(ticket: InboxTicket, until: Date): InboxTicket {
  const section =
    ticket.status === 'done'
      ? 'done'
      : ticket.chat?.state === 'running'
        ? 'spark'
        : ticket.status === 'in_review' || ticket.pullRequest
          ? 'review'
          : ticket.status === 'in_progress' || ticket.chat
            ? 'started'
            : 'up_next';
  return {
    ...ticket,
    section,
    flags: [],
    reason: 'Snoozed',
    tone: 'none',
    snooze: { until: until.toISOString(), rules: ticket.flags.map((flag) => flag.rule) },
  };
}

export function useSnooze(ticket: InboxTicket | null) {
  const queryClient = useQueryClient();
  const saved = (inbox: TicketInbox) => queryClient.setQueryData(ticketKeys.inbox, inbox);
  const patch = (next: InboxTicket) => {
    const before = queryClient.getQueryData<TicketInbox>(ticketKeys.inbox);
    if (before) {
      queryClient.setQueryData<TicketInbox>(ticketKeys.inbox, {
        ...before,
        tickets: before.tickets.map((entry) =>
          entry.source === next.source && entry.key === next.key ? next : entry,
        ),
      });
    }
    return { before };
  };
  const restore = (
    _error: Error,
    _input: unknown,
    context: { before: TicketInbox | undefined } | undefined,
  ) => {
    if (context?.before) queryClient.setQueryData(ticketKeys.inbox, context.before);
  };
  const snooze = useMutation({
    mutationFn: ({ ticket: target, until }: { ticket: InboxTicket; until: Date }) =>
      ticketsApi.snooze(target.source, target.key, {
        until: until.toISOString(),
        rules: target.flags.map((flag) => flag.rule),
      }),
    onMutate: ({ ticket: target, until }) => patch(snoozedLocally(target, until)),
    onError: restore,
    onSuccess: saved,
  });
  const wake = useMutation({
    mutationFn: (target: InboxTicket) => ticketsApi.unsnooze(target.source, target.key),
    onSuccess: saved,
  });
  return {
    pending: snooze.isPending || wake.isPending,
    error: snooze.error?.message ?? wake.error?.message ?? null,
    snooze: (until: Date) => {
      if (!ticket) return;
      wake.reset();
      snooze.mutate({ ticket, until });
    },
    wake: () => {
      if (!ticket) return;
      snooze.reset();
      wake.mutate(ticket);
    },
  };
}

type Snoozing = ReturnType<typeof useSnooze>;

export function SnoozeButton({ ticket, snoozing }: { ticket: InboxTicket; snoozing: Snoozing }) {
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const panelId = useId();
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState<Date | undefined>();
  const now = new Date();
  const first = addDays(now, 1);
  const last = addDays(now, SNOOZE_MAX_DAYS - 1);
  const pick = (until: Date) => {
    setOpen(false);
    snoozing.snooze(until);
  };

  return (
    <div className="snz">
      <button
        ref={anchorRef}
        type="button"
        className="btn line sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={snoozing.pending}
        onClick={() => {
          if (!open) {
            setPicking(false);
            setDay(undefined);
          }
          toggle();
        }}
      >
        <Glyph name="snooze" />
        Remind me later
      </button>
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-label={`Remind me about ${ticket.key}`}
        className={['snz-menu', open ? 'open' : '', picking ? 'picking' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {picking ? (
          <>
            <button type="button" className="snz-back" onClick={() => setPicking(false)}>
              <BackIcon />
              Pick a day
            </button>
            <DayCalendar
              mode="single"
              selected={day}
              onSelect={setDay}
              defaultMonth={first}
              startMonth={first}
              endMonth={last}
              disabled={[{ before: first }, { after: last }]}
            />
            <button
              type="button"
              className="btn primary sm snz-go"
              disabled={!day}
              onClick={() => day && pick(morningOf(day))}
            >
              {day ? `Snooze until ${snoozeTime(morningOf(day), now)}` : 'Choose a day'}
            </button>
          </>
        ) : (
          <>
            {snoozeChoices(now).map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="snz-opt"
                onClick={() => pick(choice.until)}
              >
                <b>{choice.label}</b>
                <small>{snoozeTime(choice.until, now)}</small>
              </button>
            ))}
            <button type="button" className="snz-opt snz-more" onClick={() => setPicking(true)}>
              <b>Pick a day…</b>
              <small>9:00 AM</small>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function SnoozeError({ snoozing }: { snoozing: Snoozing }) {
  if (!snoozing.error) return null;
  return (
    <p className="snz-err" role="alert">
      Couldn't change the reminder. {snoozing.error}
    </p>
  );
}

export function SnoozedNote({ ticket, snoozing }: { ticket: InboxTicket; snoozing: Snoozing }) {
  if (!ticket.snooze) return null;
  const until = new Date(ticket.snooze.until);
  return (
    <div className="snz-note">
      <Glyph name="snooze" />
      <span>
        <b>Snoozed until {snoozeTime(until, new Date())}</b>
        <small>It comes back sooner if something new needs you.</small>
      </span>
      <button
        type="button"
        className="btn ghost sm"
        disabled={snoozing.pending}
        onClick={snoozing.wake}
      >
        Unsnooze
      </button>
    </div>
  );
}
