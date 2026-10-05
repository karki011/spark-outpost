import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sparkRetryAllowed, type Approval } from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { queryKeys } from '../../api/client.ts';
import { taskKeys } from '../../tasks/task-api.ts';

export function RetryAction({ approval }: { approval: Approval }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => approvalsApi.retry(approval.id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
  const action = approval.payload.sparkAction;
  if (!action || !sparkRetryAllowed(action, approval.payload.sparkResult)) return null;
  return (
    <>
      <button
        type="button"
        className="btn line sm"
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
      >
        Try again
      </button>
      {retry.isError && (
        <span className="appr-retry-err" role="alert">
          {retry.error.message}
        </span>
      )}
    </>
  );
}
