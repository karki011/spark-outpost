import { useMutation } from '@tanstack/react-query';
import type { InboxTicket } from '@spark-outpost/contracts';
import type { ToastSpec } from '../conversations/use-toast.ts';
import { keepListFocus } from './keep-list-focus.ts';
import { withoutAttention } from './ticket-optimistic.ts';
import { ticketId } from './ticket-model.ts';
import { ticketsApi } from './tickets-api.ts';
import { useInboxMarks } from './use-inbox-marks.ts';

export function useDismiss(ticket: InboxTicket | null, showToast: (toast: ToastSpec) => void) {
  const marks = useInboxMarks();
  const restore = useMutation({
    mutationKey: marks.key,
    mutationFn: (target: InboxTicket) => ticketsApi.undismiss(target.source, target.key),
    onMutate: (target) => marks.apply(target, target),
    onSuccess: marks.reconcile,
    onError: (error: Error, target, context) => {
      marks.rollback(context);
      showToast({ text: `Couldn't bring ${target.key} back. ${error.message}` });
    },
  });
  const dismiss = useMutation({
    mutationKey: marks.key,
    mutationFn: (target: InboxTicket) =>
      ticketsApi.dismiss(target.source, target.key, {
        flags: target.flags.map((flag) => flag.key),
      }),
    onMutate: (target) => {
      keepListFocus(ticketId(target));
      return marks.apply(target, withoutAttention(target));
    },
    onSuccess: (inbox, target) => {
      marks.reconcile(inbox);
      showToast({
        text: `Dismissed ${target.key}. It comes back if something changes.`,
        undo: () => restore.mutate(target),
      });
    },
    onError: (_error: Error, _target, context) => marks.rollback(context),
  });
  return {
    pending: dismiss.isPending,
    error: dismiss.error?.message ?? null,
    dismiss: () => {
      if (ticket) dismiss.mutate(ticket);
    },
  };
}
