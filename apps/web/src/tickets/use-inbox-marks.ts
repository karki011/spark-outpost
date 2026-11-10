import { useQueryClient } from '@tanstack/react-query';
import type { InboxTicket, TicketInbox } from '@spark-outpost/contracts';
import { findTicket, replaceTicket } from './ticket-optimistic.ts';
import { ticketKeys } from './tickets-api.ts';

export const MARK_MUTATION_KEY = ['tickets', 'mark'] as const;

export interface MarkContext {
  before: InboxTicket | undefined;
}

export function useInboxMarks() {
  const queryClient = useQueryClient();
  const write = (change: (inbox: TicketInbox) => TicketInbox) => {
    const inbox = queryClient.getQueryData<TicketInbox>(ticketKeys.inbox);
    if (inbox) queryClient.setQueryData<TicketInbox>(ticketKeys.inbox, change(inbox));
  };
  return {
    key: MARK_MUTATION_KEY,
    async apply(target: InboxTicket, next: InboxTicket): Promise<MarkContext> {
      await queryClient.cancelQueries({ queryKey: ticketKeys.inbox, exact: true });
      const inbox = queryClient.getQueryData<TicketInbox>(ticketKeys.inbox);
      const before = inbox ? findTicket(inbox, target) : undefined;
      write((current) => replaceTicket(current, next));
      return { before };
    },
    rollback(context: MarkContext | undefined) {
      const before = context?.before;
      if (before) write((current) => replaceTicket(current, before));
      if (queryClient.isMutating({ mutationKey: MARK_MUTATION_KEY }) > 1) return;
      void queryClient.invalidateQueries({ queryKey: ticketKeys.inbox, exact: true });
    },
    reconcile(inbox: TicketInbox) {
      if (queryClient.isMutating({ mutationKey: MARK_MUTATION_KEY }) > 1) return;
      queryClient.setQueryData(ticketKeys.inbox, inbox);
    },
  };
}
