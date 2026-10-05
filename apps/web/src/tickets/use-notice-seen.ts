import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InboxTicket, TicketInbox } from '@spark-outpost/contracts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

export function useNoticeSeen() {
  const queryClient = useQueryClient();
  return useCallback(
    (ticket: InboxTicket) => {
      const notice = ticket.notice;
      if (!notice || notice.seen) return;
      queryClient.setQueryData<TicketInbox>(
        ticketKeys.inbox,
        (inbox) =>
          inbox && {
            ...inbox,
            tickets: inbox.tickets.map((entry) =>
              entry.source === ticket.source && entry.key === ticket.key
                ? { ...entry, notice: { ...notice, seen: true } }
                : entry,
            ),
          },
      );
      ticketsApi
        .noticeSeen(ticket.source, ticket.key, notice.id)
        .catch(() => queryClient.invalidateQueries({ queryKey: ticketKeys.inbox, exact: true }));
    },
    [queryClient],
  );
}
