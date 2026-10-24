import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MemberMessage } from '@spark-outpost/contracts';
import { queryKeys } from '../../api/client.ts';
import { queueDraft, requestComposerFocus } from '../composer/pending-draft.ts';
import { queueApi } from '../queue/queue-api.ts';

type SteerAction = { kind: 'resend' | 'edit'; messages: readonly MemberMessage[] };

async function apply(conversationId: string, { kind, messages }: SteerAction): Promise<void> {
  for (const message of messages) {
    if (kind === 'resend') await queueApi.resendSteer(conversationId, message.id);
    else await queueApi.dropSteer(conversationId, message.id);
  }
  if (kind === 'edit') {
    queueDraft(conversationId, messages.map((message) => message.body).join('\n\n'));
  } else {
    requestComposerFocus(conversationId);
  }
}

export function useSteerActions(conversationId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ['steer', conversationId],
    mutationFn: (action: SteerAction) => apply(conversationId, action),
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
