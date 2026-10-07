import './result-block.css';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Run } from '@spark-outpost/contracts';
import { CheckIcon, ChevronIcon, RestoreIcon } from '../../ui/icons.tsx';
import { RevertRun } from '../approvals/RevertRun.tsx';
import { FilesChanged } from '../changes/FilesChanged.tsx';
import { checkpointResult, type CheckpointApproval } from '../checkpoints/checkpoint-model.ts';
import { prWatchesQuery } from '../pull-request/pr-follow-up-api.ts';
import { BringChanges } from './BringChanges.tsx';
import type { KeepCardHost } from './feedback-host.ts';
import { keptLine, pullReferences } from './result-model.ts';
import { TurnFeedback } from './TurnFeedback.tsx';
import { WorthALook } from './WorthALook.tsx';

interface ResultBlockProps {
  approval: CheckpointApproval;
  variant: KeepCardHost['variant'];
  runId: string;
  runIds: readonly string[];
  revertible: Run | null;
  taskId: string | null;
  conversationId: string;
}

function PullReferences({ conversationId }: { conversationId: string }) {
  const watches = useQuery({
    ...prWatchesQuery(conversationId),
    select: (list) => pullReferences(list.watches),
    notifyOnChangeProps: ['data'],
  });
  return (
    <>
      {(watches.data ?? []).map((pull) => (
        <a
          key={pull.url}
          className="result-pr"
          href={pull.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Pull request #${pull.number}`}
        >
          PR #{pull.number}
        </a>
      ))}
    </>
  );
}

function StoredFiles({ approval }: { approval: CheckpointApproval }) {
  return (
    <ul className="result-files" aria-label="Changed files">
      {approval.payload.checkpoint.files.map((file) => (
        <li key={file.path}>
          <code>{file.path}</code> <small>{file.change}</small>
        </li>
      ))}
    </ul>
  );
}

export function ResultBlock({
  approval,
  variant,
  runId,
  runIds,
  revertible,
  taskId,
  conversationId,
}: ResultBlockProps) {
  const [open, setOpen] = useState(false);
  const moreId = useId();
  const checkpoint = approval.payload.checkpoint;
  const kept = variant === 'kept';
  const line = keptLine(checkpoint);
  const who = checkpointResult(approval);
  return (
    <section className={kept ? 'result' : 'result reverted'} aria-label={kept ? line : 'Reverted'}>
      <div className="result-line">
        {kept && (
          <button
            type="button"
            className="result-toggle"
            aria-expanded={open}
            aria-controls={open ? moreId : undefined}
            onClick={() => setOpen(!open)}
          >
            <ChevronIcon />
            <CheckIcon />
            <span>{line}</span>
          </button>
        )}
        {kept && <PullReferences conversationId={conversationId} />}
        <TurnFeedback key={variant} runId={runId} variant={variant} />
        {revertible ? (
          <RevertRun key="revert" run={revertible} compact />
        ) : (
          !kept && (
            <p className="revert-done" role="status">
              <RestoreIcon />
              {who}
            </p>
          )
        )}
      </div>
      {kept && checkpoint.keptNote && <p className="result-note">{checkpoint.keptNote}</p>}
      {kept && open && (
        <div id={moreId} className="result-more">
          <p className="result-why">
            {checkpoint.keptBy ? checkpoint.reason || who : `${who} ${checkpoint.reason}`.trim()}
          </p>
          {taskId ? (
            <FilesChanged taskId={taskId} runIds={runIds} />
          ) : (
            <StoredFiles approval={approval} />
          )}
          <BringChanges conversationId={conversationId} />
        </div>
      )}
      {kept && <WorthALook payload={checkpoint} />}
    </section>
  );
}
