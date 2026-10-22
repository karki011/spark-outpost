import { useMutation, useQueryClient } from '@tanstack/react-query';
import { holdsToConfirm, SPARK_ACTION_OPTION, type Approval } from '@spark-outpost/contracts';
import { approvalsApi } from '../api/approvals.ts';
import { queryKeys } from '../api/client.ts';

function outcome(approval: Approval): string {
  if (approval.status !== 'allowed' || approval.decisionOptionId === SPARK_ACTION_OPTION.decline) {
    return 'Not done.';
  }
  const result = approval.payload.sparkResult;
  if (result?.state === 'done') return result.message ?? 'Done.';
  if (result?.state === 'failed') return `Couldn’t do it: ${result.message ?? 'it failed.'}`;
  if (result?.state === 'unknown') return 'Spark restarted before this finished.';
  return 'Doing it…';
}

const ANSWERED_HERE: ReadonlySet<string> = new Set([
  'ask_spark',
  'calendar_read',
  'atlassian_read',
  'read_page',
  'open_page',
  'comment_ticket',
  'transition_ticket',
]);

export function answeredInIsland(approval: Approval): boolean {
  const action = approval.payload.sparkAction?.action;
  return action !== undefined && ANSWERED_HERE.has(action) && !holdsToConfirm(approval.payload);
}

interface AskCardProps {
  approval: Approval;
  conversationId: string;
  onOpen: () => void;
}

export function AskCard({ approval, conversationId, onOpen }: AskCardProps) {
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (optionId: string) =>
      approvalsApi.decide(approval.id, {
        optionId,
        scope: 'once',
        payloadHash: approval.payloadHash,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) }),
  });
  const pending = approval.status === 'pending';
  const confirm = approval.options.find((option) => option.kind === 'allow_once');
  const decline = approval.options.find((option) => option.kind === 'reject_once');
  return (
    <div className="isl-ask-card" role="group" aria-label={approval.title}>
      <p className="isl-ask-card-title">{approval.title}</p>
      {pending && !answeredInIsland(approval) ? (
        <div className="isl-acts">
          <button type="button" className="isl-btn primary" onClick={onOpen}>
            Review in Spark
          </button>
        </div>
      ) : pending ? (
        <div className="isl-acts">
          {confirm && (
            <button
              type="button"
              className="isl-btn primary"
              disabled={decide.isPending}
              onClick={() => decide.mutate(confirm.optionId)}
            >
              {confirm.name}
            </button>
          )}
          {decline && (
            <button
              type="button"
              className="isl-btn"
              disabled={decide.isPending}
              onClick={() => decide.mutate(decline.optionId)}
            >
              {decline.name}
            </button>
          )}
        </div>
      ) : (
        <small className="isl-ask-src" role="status">
          {outcome(approval)}
        </small>
      )}
      {decide.error && (
        <p className="isl-err" role="alert">
          {decide.error.message}
        </p>
      )}
    </div>
  );
}
