import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REMOTE_SPARK_NAME_MAX, type RemoteSpark } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { CheckIcon, ClockIcon } from '../ui/icons.tsx';
import { remoteSparkKeys, remoteSparksApi } from './remote-sparks-api.ts';
import { lastOpenedLine, pairedWord } from './remote-sparks-copy.ts';

function RenameSpark({ spark, onDone }: { spark: RemoteSpark; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(spark.name);
  const rename = useMutation({
    mutationFn: () => remoteSparksApi.rename(spark.id, name.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) rename.mutate();
  };
  return (
    <form className="ph-rename" onSubmit={submit}>
      <input
        className="inp"
        aria-label={`New name for ${spark.name}`}
        value={name}
        maxLength={REMOTE_SPARK_NAME_MAX}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
      />
      <button type="submit" className="btn primary sm" disabled={rename.isPending || !name.trim()}>
        Save
      </button>
      <button type="button" className="btn ghost sm" onClick={onDone}>
        Cancel
      </button>
      {rename.error && (
        <p className="ph-error" role="alert">
          {rename.error.message}
        </p>
      )}
    </form>
  );
}

interface SparkRowProps {
  spark: RemoteSpark;
  now: number;
  onRemove: (spark: RemoteSpark, from: HTMLButtonElement) => void;
}

export function SparkRow({ spark, now, onRemove }: SparkRowProps) {
  const queryClient = useQueryClient();
  const renameButton = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const open = useMutation({
    mutationFn: () => remoteSparksApi.open(spark.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all }),
  });
  const finishRename = () => {
    setRenaming(false);
    requestAnimationFrame(() => renameButton.current?.focus());
  };
  return (
    <li className="rs-row">
      <span className="ph-device-icon" aria-hidden="true">
        <BlobScout size={20} />
      </span>
      <div className="ph-device-body rs-body">
        {renaming ? (
          <RenameSpark spark={spark} onDone={finishRename} />
        ) : (
          <>
            <div className="ph-device-line">
              <b>{spark.name}</b>
              <span className={spark.paired ? 'ph-connected' : 'rs-waiting'}>
                {spark.paired ? <CheckIcon /> : <ClockIcon />}
                {pairedWord(spark)}
              </span>
            </div>
            <span className="ph-device-summary">
              {spark.hostname} · {lastOpenedLine(spark, now)}
            </span>
          </>
        )}
      </div>
      {!renaming && (
        <div className="rs-actions">
          <button
            type="button"
            className="btn line sm"
            aria-label={`Open ${spark.name}`}
            disabled={open.isPending}
            onClick={() => open.mutate()}
          >
            Open
          </button>
          <button
            ref={renameButton}
            type="button"
            className="btn ghost sm"
            aria-label={`Rename ${spark.name}`}
            onClick={() => setRenaming(true)}
          >
            Rename
          </button>
          <button
            type="button"
            className="btn ghost sm"
            aria-label={`Remove ${spark.name}`}
            onClick={(event) => onRemove(spark, event.currentTarget)}
          >
            Remove
          </button>
        </div>
      )}
      {open.error && (
        <p className="ph-error rs-row-note" role="alert">
          {open.error.message}
        </p>
      )}
    </li>
  );
}
