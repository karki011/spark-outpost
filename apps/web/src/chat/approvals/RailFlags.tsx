import './rail-flags.css';
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail, RailFlag, RailOriginal } from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { queryKeys } from '../../api/client.ts';
import { taskKeys } from '../../tasks/task-api.ts';
import { ShieldIcon } from '../../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { RowIcon } from '../rows/RowIcon.tsx';
import { flagNote } from './rail-flag-text.ts';

function Original({ original }: { original: RailOriginal }) {
  const { state, copy } = useCopyFeedback();
  return (
    <details className="rail-original">
      <summary>Original of {original.path}</summary>
      <pre>{original.text}</pre>
      <button type="button" className="btn line sm" onClick={() => copy(original.text)}>
        {copyButtonText(state)}
      </button>
    </details>
  );
}

function settledLine(flag: RailFlag): string {
  return flag.status === 'reverted' ? 'Reverted to before this run.' : 'Dismissed.';
}

export function RailFlagCard({ flag, conversationId }: { flag: RailFlag; conversationId: string }) {
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (action: 'dismiss' | 'revert') => approvalsApi.decideFlag(flag.id, { action }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
  const open = flag.status === 'open';
  return (
    <section className={open ? 'rail-flag' : 'rail-flag settled'} aria-label="Flagged by Spark">
      <p className="rail-flag-h">
        <ShieldIcon />
        <b>{flag.title}</b>
      </p>
      {open ? (
        <>
          <p className="rail-flag-sub">{flagNote(flag)}</p>
          {flag.originals.map((original) => (
            <Original key={original.path} original={original} />
          ))}
          {decide.isError && (
            <p className="rail-flag-err" role="alert">
              {decide.error.message}
            </p>
          )}
          <div className="rail-flag-actions">
            {flag.inside && (
              <button
                type="button"
                className="btn line sm"
                disabled={decide.isPending}
                onClick={() => decide.mutate('revert')}
              >
                Revert
              </button>
            )}
            <button
              type="button"
              className="btn ghost sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate('dismiss')}
            >
              Got it
            </button>
          </div>
        </>
      ) : (
        <p className="rail-flag-sub" role="status">
          {settledLine(flag)}
        </p>
      )}
    </section>
  );
}

function FlagLine({ flag, conversationId }: { flag: RailFlag; conversationId: string }) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const settled = flag.status !== 'open';
  return (
    <>
      <div className={settled ? 'flag-line settled' : 'flag-line'}>
        <RowIcon name="flag" />
        <span className="flag-line-text">
          <b>Flag</b>: {flag.title}
          {settled && <span className="flag-line-state"> · {settledLine(flag)}</span>}
        </span>
        <button
          type="button"
          className="flag-line-details"
          aria-expanded={open}
          aria-controls={cardId}
          onClick={() => setOpen(!open)}
        >
          Details
        </button>
      </div>
      <div id={cardId} hidden={!open}>
        {open && <RailFlagCard flag={flag} conversationId={conversationId} />}
      </div>
    </>
  );
}

export function RailFlags({ detail, runId }: { detail: ConversationDetail; runId: string }) {
  const flags = (detail.railFlags ?? []).filter((flag) => flag.turnRunId === runId);
  if (flags.length === 0) return null;
  return (
    <>
      {flags.map((flag) => (
        <FlagLine key={flag.id} flag={flag} conversationId={detail.conversation.id} />
      ))}
    </>
  );
}

export function OpenRailFlags({ detail }: { detail: ConversationDetail }) {
  const flags = (detail.railFlags ?? []).filter((flag) => flag.status === 'open');
  if (flags.length === 0) return null;
  return (
    <div className="native-approvals" role="group" aria-label="Flagged by Spark">
      {flags.map((flag) => (
        <RailFlagCard key={flag.id} flag={flag} conversationId={detail.conversation.id} />
      ))}
    </div>
  );
}
