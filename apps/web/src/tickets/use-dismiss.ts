import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InboxTicket, TicketInbox } from '@spark-outpost/contracts';
import type { ToastSpec } from '../conversations/use-toast.ts';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

export function useDismiss(ticket: InboxTicket | null, showToast: (toast: ToastSpec) => void) {
  const queryClient = useQueryClient();
  const saved = (inbox: TicketInbox) => queryClient.setQueryData(ticketKeys.inbox, inbox);
  const restore = useMutation({
    mutationFn: (target: InboxTicket) => ticketsApi.undismiss(target.source, target.key),
    onSuccess: saved,
    onError: (error: Error, target) =>
      showToast({ text: `Couldn't bring ${target.key} back. ${error.message}` }),
  });
  const dismiss = useMutation({
    mutationFn: (target: InboxTicket) =>
      ticketsApi.dismiss(target.source, target.key, {
        flags: target.flags.map((flag) => flag.key),
      }),
    onSuccess: (inbox, target) => {
      saved(inbox);
      showToast({
        text: `Dismissed ${target.key}. It comes back if something changes.`,
        undo: () => restore.mutate(target),
      });
    },
  });
  return {
    pending: dismiss.isPending,
    error: dismiss.error?.message ?? null,
    dismiss: () => {
      if (ticket) dismiss.mutate(ticket);
    },
  };
}
