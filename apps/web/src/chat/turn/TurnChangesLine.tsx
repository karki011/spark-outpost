import type { Run } from '@spark-outpost/contracts';
import { RevertChanged } from '../approvals/RevertChanged.tsx';
import { Counts } from '../changes/FileChangeList.tsx';
import { filesLabel } from '../changes/change-rules.ts';
import type { CheckpointApproval } from '../checkpoints/checkpoint-model.ts';
import type { KeepCardHost } from '../outcomes/feedback-host.ts';
import { ResultBlock } from '../outcomes/ResultBlock.tsx';
import { RowIcon } from '../rows/RowIcon.tsx';
import type { TurnChanges } from '../rows/use-turn-changes.ts';

interface TurnChangesLineProps {
  kept: CheckpointApproval | null;
  host: KeepCardHost | null;
  changes: TurnChanges | null;
  revertible: Run | null;
  runIds: readonly string[];
  taskId: string | null;
  conversationId: string;
}

export function TurnChangesLine({
  kept,
  host,
  changes,
  revertible,
  runIds,
  taskId,
  conversationId,
}: TurnChangesLineProps) {
  const review = changes?.open ? () => changes.open?.() : null;
  if (host && kept) {
    return (
      <ResultBlock
        approval={kept}
        variant={host.variant}
        runIds={runIds}
        revertible={revertible}
        taskId={taskId}
        conversationId={conversationId}
        onReview={review}
      />
    );
  }
  const revert = revertible ? (
    <RevertChanged run={revertible} taskId={taskId} runIds={runIds} />
  ) : null;
  if (!changes) return revert;
  return (
    <div className="turn-line" role="group" aria-label={`Changed ${filesLabel(changes.files)}`}>
      <RowIcon name="files" />
      <span>Changed {filesLabel(changes.files)}</span>
      <Counts added={changes.added} removed={changes.removed} />
      {review && (
        <button type="button" className="linkish" onClick={review}>
          Review
        </button>
      )}
      {revert}
    </div>
  );
}
