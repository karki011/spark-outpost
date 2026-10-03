import { useQuery } from '@tanstack/react-query';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

const INBOX_STALE_MS = 60_000;

export function useTicketInbox() {
  const connections = useQuery({
    queryKey: ticketKeys.connections,
    queryFn: ticketsApi.connections,
  });
  const connected = (connections.data?.connections ?? []).some((entry) => entry.keySaved);
  const inbox = useQuery({
    queryKey: ticketKeys.inbox,
    queryFn: ticketsApi.inbox,
    enabled: connected,
    staleTime: INBOX_STALE_MS,
  });
  return { connections, connected, inbox };
}
