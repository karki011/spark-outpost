import './snooze.css';
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SNOOZE_MAX_DAYS, type InboxTicket, type TicketInbox } from '@spark-outpost/contracts';
import { usePopover } from '../ui/use-popover.ts';
import { Glyph } from './ticket-icons.tsx';
import { morningOf, snoozeChoices, snoozeTime } from './ticket-model.ts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

const DAY_MS = 24 * 3_600_000;

const dateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function snoozedLocally(ticket: InboxTicket, until: Date): InboxTicket {
  const section =
    ticket.status === 'done'
      ? 'done'
      : ticket.status === 'in_review'
        ? 'in_review'
        : ticket.status === 'in_progress' || ticket.chat
          ? 'working'
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
  const menuId = useId();
  const dateId = useId();
  const now = new Date();
  const [day, setDay] = useState(() => dateInput(new Date(now.getTime() + 2 * DAY_MS)));
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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={snoozing.pending}
        onClick={toggle}
      >
        <Glyph name="snooze" />
        Remind me later
      </button>
      <div
        ref={panelRef}
        id={menuId}
        role="menu"
        aria-label={`Remind me about ${ticket.key}`}
        className={open ? 'snz-menu open' : 'snz-menu'}
      >
        {snoozeChoices(now).map((choice) => (
          <button key={choice.id} type="button" role="menuitem" onClick={() => pick(choice.until)}>
            <b>{choice.label}</b>
            <small>{snoozeTime(choice.until, now)}</small>
          </button>
        ))}
        <form
          className="snz-pick"
          onSubmit={(event) => {
            event.preventDefault();
            const [year, month, date] = day.split('-').map(Number);
            if (year && month && date) pick(morningOf(new Date(year, month - 1, date)));
          }}
        >
          <label htmlFor={dateId}>Pick a day</label>
          <span>
            <input
              id={dateId}
              type="date"
              className="inp"
              value={day}
              min={dateInput(new Date(now.getTime() + DAY_MS))}
              max={dateInput(new Date(now.getTime() + (SNOOZE_MAX_DAYS - 1) * DAY_MS))}
              onChange={(event) => setDay(event.target.value)}
              required
            />
            <button type="submit" className="btn primary sm">
              Snooze
            </button>
          </span>
        </form>
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
