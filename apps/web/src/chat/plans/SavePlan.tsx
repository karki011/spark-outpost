import './save-plan.css';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/client.ts';
import { plansApi } from '../../api/plans.ts';
import { taskKeys } from '../../tasks/task-api.ts';
import { CheckIcon } from '../../ui/icons.tsx';

interface SavePlanProps {
  conversationId: string;
  messageId: string;
  savedVersion: number | null;
  offered?: boolean;
}

export function SavePlan({
  conversationId,
  messageId,
  savedVersion,
  offered = false,
}: SavePlanProps) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => plansApi.save(conversationId, { messageId, offered }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
  const version = save.data?.version ?? savedVersion;
  if (version !== null) {
    if (offered) return null;
    return (
      <p className="saveplan saved" role="status">
        <CheckIcon />
        Agreed plan v{version}
      </p>
    );
  }
  return (
    <div className={offered ? 'saveplan offer' : 'saveplan'}>
      {offered && <span>Save the plan above as the agreed plan?</span>}
      <button
        type="button"
        className={offered ? 'btn primary sm' : 'btn ghost sm'}
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        Save as agreed plan
      </button>
      {save.isError && (
        <span className="saveplan-err" role="alert">
          {save.error.message}
        </span>
      )}
    </div>
  );
}
