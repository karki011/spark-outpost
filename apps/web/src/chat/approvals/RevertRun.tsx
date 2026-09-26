import './revert-run.css';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Run } from '@spark-outpost/contracts';
import { approvalKeys, approvalsApi } from '../../api/approvals.ts';
import { queryKeys } from '../../api/client.ts';
import { taskKeys } from '../../tasks/task-api.ts';
import { RestoreIcon } from '../../ui/icons.tsx';

const CHANGE_LABELS = { added: 'added', modified: 'changed', deleted: 'deleted' } as const;

function files(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

export function RevertRun({ run }: { run: Run }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const changes = useQuery({
    queryKey: approvalKeys.changes(run.id),
    queryFn: () => approvalsApi.changes(run.id),
    enabled: confirming,
    staleTime: 0,
  });
  const revert = useMutation({
    mutationFn: () => approvalsApi.revert(run.id),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(run.conversationId) });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });

  useEffect(() => {
    if (changes.data?.revertible) confirmRef.current?.focus();
  }, [changes.data?.revertible]);

  if (run.revertedAt || revert.isSuccess) {
    const count = revert.data?.restored.length;
    return (
      <p className="revert-done" role="status">
        <RestoreIcon />
        {count === undefined ? 'Reverted to before this run.' : `Reverted ${files(count)}.`}
      </p>
    );
  }

  if (!confirming) {
    return (
      <button type="button" className="btn ghost sm revert-btn" onClick={() => setConfirming(true)}>
        <RestoreIcon />
        Revert to before this run
      </button>
    );
  }

  const data = changes.data;
  return (
    <div className="revert-confirm" role="group" aria-label="Revert to before this run">
      {changes.isPending && <p>Checking what changed…</p>}
      {changes.isError && <p className="revert-err">{changes.error.message}</p>}
      {data && !data.revertible && <p>{data.reason}</p>}
      {data?.revertible && (
        <>
          <p>
            <b>Revert {files(data.files.length)}?</b> Only files changed since this run started are
            restored. Other files stay as they are.
          </p>
          <ul>
            {data.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code> <small>{CHANGE_LABELS[file.change]}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="revert-acts">
        {data?.revertible && (
          <button
            ref={confirmRef}
            type="button"
            className="btn primary sm"
            disabled={revert.isPending}
            onClick={() => revert.mutate()}
          >
            Revert
          </button>
        )}
        <button type="button" className="btn line sm" onClick={() => setConfirming(false)}>
          {data?.revertible ? 'Keep changes' : 'Close'}
        </button>
      </div>
      {revert.isError && (
        <p className="revert-err" role="alert">
          {revert.error.message}
        </p>
      )}
    </div>
  );
}
