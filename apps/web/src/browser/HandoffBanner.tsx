import { useMutation } from '@tanstack/react-query';
import { SPARK_ACTION_OPTION, type BrowserHandoff } from '@spark-outpost/contracts';
import { approvalsApi } from '../api/approvals.ts';

export function HandoffBanner({ handoff }: { handoff: BrowserHandoff }) {
  const decide = useMutation({
    mutationFn: (optionId: string) =>
      approvalsApi.decide(handoff.approvalId, { optionId, scope: 'once' }),
  });
  return (
    <div className="bp-handoff" role="region" aria-label="Sign in for the agent">
      <p>
        <b>
          {handoff.agent} is waiting for you to sign in to {handoff.site}
        </b>
        <span>Sign in below yourself. The agent never sees what you type.</span>
      </p>
      <div className="bp-handoff-actions">
        <button
          type="button"
          className="btn line sm"
          disabled={decide.isPending}
          onClick={() => decide.mutate(SPARK_ACTION_OPTION.decline)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn primary sm"
          disabled={decide.isPending}
          onClick={() => decide.mutate(SPARK_ACTION_OPTION.confirm)}
        >
          Done
        </button>
      </div>
      {decide.error && (
        <p className="bp-handoff-error" role="alert">
          {decide.error.message}
        </p>
      )}
    </div>
  );
}
