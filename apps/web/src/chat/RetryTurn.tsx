import './approvals/timed-out.css';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';

interface RetryTurnProps {
  conversationId: string;
  content: string;
}

export function RetryTurn({ conversationId, content }: RetryTurnProps) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api.sendMessage(conversationId, crypto.randomUUID(), content),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      ]),
  });
  return (
    <div className="timed-out" role="group" aria-label="Retry this turn">
      <button
        type="button"
        className="btn line sm"
        disabled={retry.isPending || retry.isSuccess}
        onClick={() => retry.mutate()}
      >
        Try again
      </button>
      {retry.isError && (
        <span className="timed-out-err" role="alert">
          {retry.error.message}
        </span>
      )}
    </div>
  );
}
