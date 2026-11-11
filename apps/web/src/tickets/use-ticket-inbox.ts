import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ticketsFlowFrom } from '@spark-outpost/contracts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

const INBOX_STALE_MS = 60_000;

export function useTicketInbox() {
  const connections = useQuery({
    queryKey: ticketKeys.connections,
    queryFn: ticketsApi.connections,
  });
  const connected = (connections.data?.connections ?? []).some(ticketsFlowFrom);
  const forced = useRef(false);
  const inbox = useQuery({
    queryKey: ticketKeys.inbox,
    queryFn: () => (forced.current ? ticketsApi.refreshedInbox() : ticketsApi.inbox()),
    enabled: connected,
    staleTime: INBOX_STALE_MS,
  });
  const refresh = () => {
    forced.current = true;
    return inbox.refetch().finally(() => {
      forced.current = false;
    });
  };
  return { connections, connected, inbox, refresh };
}
