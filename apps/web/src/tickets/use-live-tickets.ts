import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InboxTicket } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { chatLookup, liveTickets, staleChats, type LiveTicket } from './ticket-flow.ts';
import { ticketKeys } from './tickets-api.ts';

export function useLiveTickets(tickets: readonly InboxTicket[]): readonly LiveTicket[] {
  const queryClient = useQueryClient();
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const chats = useMemo(() => chatLookup(conversations.data ?? []), [conversations.data]);
  const stale = staleChats(tickets, chats);
  const refreshedFor = useRef('');
  useEffect(() => {
    if (stale === refreshedFor.current) return;
    refreshedFor.current = stale;
    if (stale) void queryClient.invalidateQueries({ queryKey: ticketKeys.inbox, exact: true });
  }, [stale, queryClient]);
  return useMemo(() => liveTickets(tickets, chats), [tickets, chats]);
}
