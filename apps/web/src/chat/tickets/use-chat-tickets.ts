import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatTicket, ChatTickets } from '@spark-outpost/contracts';
import { chatTicketsApi, chatTicketsKey } from './chat-tickets-api.ts';

const UNDO_MS = 10_000;

export type ChatTicketsState = ReturnType<typeof useChatTickets>;

export function useChatTickets(conversationId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const key = chatTicketsKey(conversationId);
  const tickets = useQuery({
    queryKey: key,
    queryFn: () => chatTicketsApi.get(conversationId),
    enabled,
  });
  const [unlinked, setUnlinked] = useState<ChatTicket | null>(null);
  const [hiddenMentions, setHiddenMentions] = useState<string>('');

  useEffect(() => {
    if (!unlinked) return;
    const timer = setTimeout(() => setUnlinked(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [unlinked]);

  const save = (data: ChatTickets) => queryClient.setQueryData(key, data);
  const link = useMutation({
    mutationFn: (ticket: ChatTicket) => chatTicketsApi.link(conversationId, ticket),
    onSuccess: (data) => {
      save(data);
      setUnlinked(null);
    },
  });
  const unlink = useMutation({
    mutationFn: (ticket: ChatTicket) => chatTicketsApi.unlink(conversationId, ticket),
    onSuccess: (data, ticket) => {
      save(data);
      setUnlinked(ticket);
    },
  });
  const dismiss = useMutation({
    mutationFn: () => chatTicketsApi.dismiss(conversationId),
    onSuccess: save,
  });

  const data = tickets.data;
  const mentionKey = (data?.mentioned ?? []).map((ticket) => ticket.key).join(' ');
  return {
    linked: data?.linked ?? [],
    suggested: data?.suggested ?? [],
    mentioned: mentionKey && mentionKey !== hiddenMentions ? (data?.mentioned ?? []) : [],
    unlinked,
    busy: link.isPending || unlink.isPending || dismiss.isPending,
    error: link.error?.message ?? unlink.error?.message ?? dismiss.error?.message ?? null,
    link: (ticket: ChatTicket) => link.mutate(ticket),
    unlink: (ticket: ChatTicket) => unlink.mutate(ticket),
    dismiss: () => dismiss.mutate(),
    hideMentions: () => setHiddenMentions(mentionKey),
  };
}
