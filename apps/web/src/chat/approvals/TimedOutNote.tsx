import './timed-out.css';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../../api/client.ts';
import { retryMessage, timedOutText } from './timed-out.ts';

interface TimedOutNoteProps {
  asked: string | null;
  conversationId: string | null;
}

export function TimedOutNote({ asked, conversationId }: TimedOutNoteProps) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: (id: string) => api.sendMessage(id, crypto.randomUUID(), retryMessage(asked)),
    onSuccess: (_sent, id) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      ]),
  });
  return (
    <div className="timed-out" role="group" aria-label="Waited for you">
      <span>{timedOutText(asked)}</span>
      {conversationId && (
        <button
          type="button"
          className="btn line sm"
          disabled={retry.isPending || retry.isSuccess}
          onClick={() => retry.mutate(conversationId)}
        >
          Try again
        </button>
      )}
      {retry.isError && (
        <span className="timed-out-err" role="alert">
          {retry.error.message}
        </span>
      )}
    </div>
  );
}
