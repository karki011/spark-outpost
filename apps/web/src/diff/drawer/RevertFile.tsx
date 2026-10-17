import '../../chat/approvals/revert-run.css';
import './revert-file.css';
import { useEffect, useRef, type KeyboardEvent, type Ref } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChangeEntry, FileRevertCheck } from '@spark-outpost/contracts';
import { taskKeys } from '../../tasks/task-api.ts';
import { RestoreIcon } from '../../ui/icons.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { diffApi, diffKeys } from '../diff-api.ts';

interface RevertFileButtonProps {
  open: boolean;
  controls: string;
  onOpen(): void;
  buttonRef: Ref<HTMLButtonElement>;
}

export function RevertFileButton({ open, controls, onOpen, buttonRef }: RevertFileButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="dd-tool dd-revert-btn"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onOpen}
    >
      <RestoreIcon />
      Revert file
    </button>
  );
}

export function revertFileText(check: FileRevertCheck): string {
  const what = check.oldPath
    ? `Moves it back to ${check.oldPath} as it was before this run.`
    : {
        added: 'Deletes it, since this run created it.',
        deleted: 'Brings it back as it was before this run.',
        modified: 'Restores it to how it was before this run.',
      }[check.change];
  const kind = {
    secret: ' This is a secret file.',
    instructions: ' This is an agent instruction file.',
  };
  const shipped = check.pushed ? 'committed and pushed' : 'committed';
  const committed = check.committed
    ? ` This run’s change is ${shipped}: only your working copy changes, and the revert shows as an uncommitted change.`
    : '';
  return `${what}${check.protectedKind ? kind[check.protectedKind] : ''}${committed} Other files stay as they are.`;
}

interface RevertFileConfirmProps {
  id: string;
  taskId: string;
  version: string | undefined;
  entry: ChangeEntry;
  onCancel(): void;
  onReverted(path: string): void;
}

export function RevertFileConfirm({
  id,
  taskId,
  version,
  entry,
  onCancel,
  onReverted,
}: RevertFileConfirmProps) {
  const queryClient = useQueryClient();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const params = { runId: entry.runId, path: entry.path, ...(version ? { version } : {}) };
  const check = useQuery({
    queryKey: diffKeys.revertCheck(taskId, params),
    queryFn: () => diffApi.revertCheck(taskId, params),
    staleTime: 0,
    gcTime: 0,
  });
  const revert = useMutation({
    mutationFn: () => diffApi.revertFile(taskId, params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      onReverted(entry.path);
    },
  });
  const data = check.data;

  useEffect(() => {
    if (data?.revertible) confirmRef.current?.focus();
  }, [data?.revertible]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onCancel();
  };

  return (
    <div
      id={id}
      className="revert-confirm dd-revert"
      role="group"
      aria-label={`Revert ${entry.path}`}
      onKeyDown={onKeyDown}
    >
      {check.isPending && <Skeleton label="Checking the file" shape="lines" rows={2} />}
      {check.isError && <p className="revert-err">{check.error.message}</p>}
      {data && !data.revertible && <p>{data.reason}</p>}
      {data?.revertible && (
        <p>
          <b>Revert {entry.path}?</b> {revertFileText(data)}
        </p>
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
            Revert file
          </button>
        )}
        <button type="button" className="btn line sm" onClick={onCancel}>
          {data?.revertible ? 'Keep file' : 'Close'}
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
