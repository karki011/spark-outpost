import { useEffect, useState } from 'react';
import {
  useMutation,
  useMutationState,
  useQueryClient,
  type Mutation,
} from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { queueDraft } from '../composer/pending-draft.ts';
import {
  nextSlowAt,
  pendingSends,
  type OutgoingMessage,
  type PendingSend,
  type SendAttempt,
} from './send-state.ts';

export interface ChatSends {
  pending: PendingSend[];
  sending: boolean;
  send: (message: Omit<OutgoingMessage, 'id'>) => void;
  retry: (message: OutgoingMessage) => void;
  edit: (message: OutgoingMessage) => void;
}

function sendKey(conversationId: string) {
  return ['send', conversationId] as const;
}

function outgoing(entry: Mutation<unknown, Error, unknown, unknown>): OutgoingMessage {
  return entry.state.variables as OutgoingMessage;
}

function toAttempt(entry: Mutation<unknown, Error, unknown, unknown>): SendAttempt {
  return {
    message: outgoing(entry),
    status: entry.state.status,
    error: entry.state.error?.message ?? null,
    submittedAt: entry.state.submittedAt,
  };
}

export function useChatSend(
  conversationId: string,
  savedIds: ReadonlySet<string>,
  onSent: () => Promise<unknown>,
): ChatSends {
  const queryClient = useQueryClient();
  const mutationKey = sendKey(conversationId);
  const mutation = useMutation({
    mutationKey,
    mutationFn: (message: OutgoingMessage) =>
      api.sendMessage(
        conversationId,
        message.id,
        message.content,
        message.attachments.map((attachment) => attachment.id),
        message.annotations,
      ),
    onSuccess: onSent,
  });
  const attempts = useMutationState({ filters: { mutationKey }, select: toAttempt });
  const [now, setNow] = useState(() => Date.now());
  const pending = pendingSends(attempts, savedIds, now);
  const slowAt = nextSlowAt(pending);

  useEffect(() => {
    if (slowAt === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, slowAt - Date.now()));
    return () => clearTimeout(timer);
  }, [slowAt]);

  const inFlight = () =>
    queryClient
      .getMutationCache()
      .findAll({ mutationKey, status: 'pending' })
      .some((entry) => !savedIds.has(outgoing(entry).id));

  return {
    pending,
    sending: pending.some((send) => send.phase !== 'failed'),
    send: (message) => {
      if (inFlight()) return;
      mutation.mutate({ ...message, id: crypto.randomUUID() });
    },
    retry: (message) => mutation.mutate(message),
    edit: (message) => {
      const cache = queryClient.getMutationCache();
      cache
        .findAll({ mutationKey, predicate: (entry) => outgoing(entry).id === message.id })
        .forEach((entry) => cache.remove(entry));
      queueDraft(conversationId, message.content);
    },
  };
}
