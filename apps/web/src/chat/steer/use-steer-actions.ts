import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MemberMessage } from '@spark-outpost/contracts';
import { queryKeys } from '../../api/client.ts';
import { queueDraftAfterTyped, requestComposerFocus } from '../composer/pending-draft.ts';
import { queueApi } from '../queue/queue-api.ts';

type SteerAction = { kind: 'resend' | 'edit'; messages: readonly MemberMessage[] };

async function resend(conversationId: string, messages: readonly MemberMessage[]) {
  for (const message of messages) await queueApi.resendSteer(conversationId, message.id);
  requestComposerFocus(conversationId);
}

async function edit(conversationId: string, messages: readonly MemberMessage[]) {
  const dropped: string[] = [];
  try {
    for (const message of messages) {
      await queueApi.dropSteer(conversationId, message.id);
      dropped.push(message.body);
    }
  } finally {
    if (dropped.length > 0) queueDraftAfterTyped(conversationId, dropped.join('\n\n'));
  }
}

function applySteerAction(conversationId: string, action: SteerAction): Promise<void> {
  return action.kind === 'resend'
    ? resend(conversationId, action.messages)
    : edit(conversationId, action.messages);
}

export function useSteerActions(conversationId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ['steer', conversationId],
    mutationFn: (action: SteerAction) => applySteerAction(conversationId, action),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
  });
  return {
    pending: mutation.isPending,
    error: mutation.error?.message ?? null,
    resend: (messages: readonly MemberMessage[]) => mutation.mutate({ kind: 'resend', messages }),
    edit: (messages: readonly MemberMessage[]) => mutation.mutate({ kind: 'edit', messages }),
  };
}
