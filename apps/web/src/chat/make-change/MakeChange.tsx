import './make-change.css';
import type { ConversationDetail, Run } from '@spark-outpost/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../../api/client.ts';
import { answeredInsteadOfChange } from './make-change.ts';

interface MakeChangeProps {
  run: Run;
  detail: ConversationDetail;
}

export function MakeChange({ run, detail }: MakeChangeProps) {
  const queryClient = useQueryClient();
  const conversationId = detail.conversation.id;
  const request = detail.messages.find((message) => message.id === run.userMessageId);
  const change = useMutation({
    mutationFn: (content: string) =>
      api.sendMessage(conversationId, crypto.randomUUID(), content, [], [], 'change'),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      ]),
  });
  if (!request?.content || !answeredInsteadOfChange(run, detail)) return null;
  return (
    <div className="make-change">
      <span>Answered without changing files.</span>
      <button
        type="button"
        className="btn line sm"
        disabled={change.isPending || change.isSuccess}
        onClick={() => change.mutate(request.content)}
      >
        Make the change
      </button>
      {change.isError && (
        <span className="make-change-err" role="alert">
          {change.error.message}
        </span>
      )}
    </div>
  );
}
