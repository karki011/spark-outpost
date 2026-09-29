import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ticketSourceNames,
  type AssignTicketResponse,
  type TicketPerson,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import type { ToastSpec } from '../conversations/use-toast.ts';
import { ticketId } from './ticket-model.ts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

export interface AssignableTicket {
  source: TicketSourceId;
  key: string;
  assignedTo: TicketPerson | null;
}

export type AssignOrigin = 'row' | 'detail';

export interface AssignState {
  pending: string | null;
  confirming: { id: string; origin: AssignOrigin } | null;
  errors: Record<string, string>;
  assigned: Record<string, true>;
}

function undoText(key: string, previous: TicketPerson | null): string {
  return previous ? `Gave ${key} back to ${previous.name}.` : `${key} is unassigned again.`;
}

export function useAssign(showToast: (toast: ToastSpec) => void) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AssignState>({
    pending: null,
    confirming: null,
    errors: {},
    assigned: {},
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ticketKeys.all }),
    [queryClient],
  );

  const settle = useCallback((id: string, error: string | null, assigned: boolean) => {
    setState((current) => {
      const errors = { ...current.errors };
      if (error) errors[id] = error;
      else delete errors[id];
      const done = { ...current.assigned };
      if (assigned) done[id] = true;
      else delete done[id];
      return { ...current, pending: null, errors, assigned: done };
    });
  }, []);

  const undo = useCallback(
    async (ticket: AssignableTicket, result: AssignTicketResponse) => {
      const id = ticketId(ticket);
      setState((current) => ({ ...current, pending: id }));
      try {
        await ticketsApi.assign(ticket.source, ticket.key, {
          to: result.previous,
          expectedAssigneeId: result.ticket.assignedTo?.id ?? null,
          confirmTakeover: true,
        });
        settle(id, null, false);
        showToast({ text: undoText(ticket.key, result.previous) });
      } catch (error) {
        settle(id, (error as Error).message, true);
      }
      await refresh();
    },
    [refresh, settle, showToast],
  );

  const assign = useCallback(
    async (ticket: AssignableTicket, confirmTakeover: boolean) => {
      const id = ticketId(ticket);
      setState((current) => ({ ...current, pending: id, confirming: null }));
      try {
        const result = await ticketsApi.assign(ticket.source, ticket.key, {
          to: 'me',
          expectedAssigneeId: ticket.assignedTo?.id ?? null,
          confirmTakeover,
        });
        settle(id, null, true);
        showToast({
          text: `Assigned ${ticket.key} to you in ${ticketSourceNames[ticket.source]}.`,
          undo: () => void undo(ticket, result),
        });
      } catch (error) {
        settle(id, (error as Error).message, false);
      }
      await refresh();
    },
    [refresh, settle, showToast, undo],
  );

  const request = useCallback(
    (ticket: AssignableTicket, mine: boolean, origin: AssignOrigin) => {
      if (ticket.assignedTo && !mine) {
        setState((current) => ({ ...current, confirming: { id: ticketId(ticket), origin } }));
        return;
      }
      void assign(ticket, false);
    },
    [assign],
  );

  const cancel = useCallback(() => setState((current) => ({ ...current, confirming: null })), []);

  const isConfirming = (ticket: AssignableTicket, origin: AssignOrigin) =>
    state.confirming?.id === ticketId(ticket) && state.confirming.origin === origin;

  return {
    state,
    request,
    isConfirming,
    confirm: (ticket: AssignableTicket) => assign(ticket, true),
    cancel,
  };
}

export type Assigner = ReturnType<typeof useAssign>;
