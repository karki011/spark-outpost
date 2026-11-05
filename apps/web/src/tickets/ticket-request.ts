import { useEffect } from 'react';
import { ticketItemId, type TicketSourceId } from '@spark-outpost/contracts';

const listeners = new Set<(itemId: string) => void>();

export function requestTicket(ticket: { source: TicketSourceId; key: string }): void {
  const itemId = ticketItemId(ticket.source, ticket.key);
  for (const listener of listeners) listener(itemId);
}

export function useTicketRequests(open: (itemId: string) => void): void {
  useEffect(() => {
    listeners.add(open);
    return () => {
      listeners.delete(open);
    };
  }, [open]);
}
