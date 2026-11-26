import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RemoteSpark } from '@spark-outpost/contracts';
import { MenuItem } from '../conversations/MenuShell.tsx';
import { ActionsMenu, useActionsButton } from './ActionsMenu.tsx';
import { remoteSparkKeys, remoteSparksApi } from './remote-sparks-api.ts';
import { CHANGE_ICON_ITEM, REMOVE_ICON_ITEM, lastOpenedLine } from './remote-sparks-copy.ts';
import { RenameForm } from './RenameForm.tsx';
import { SparkIcon } from './SparkIcon.tsx';
import { SparkStatus } from './SparkStatus.tsx';
import { useSparkIcon } from './use-spark-icon.tsx';

export const ROW_ICON_SIZE = 28;

interface SparkRowProps {
  spark: RemoteSpark;
  now: number;
  onRemove: (spark: RemoteSpark, from: HTMLButtonElement) => void;
}

export function SparkRow({ spark, now, onRemove }: SparkRowProps) {
  const queryClient = useQueryClient();
  const actions = useActionsButton();
  const icon = useSparkIcon(spark.id, spark.name);
  const [renaming, setRenaming] = useState(false);
  const open = useMutation({
    mutationFn: () => remoteSparksApi.open(spark.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all }),
  });
  const finishRename = () => {
    setRenaming(false);
    actions.focus();
  };
  const problem = open.error?.message ?? icon.problem;
  return (
    <li className="rs-row">
      <SparkIcon icon={spark.icon} size={ROW_ICON_SIZE} />
      <div className="ph-device-body rs-body">
        {renaming ? (
          <RenameForm
            label={`New name for ${spark.name}`}
            initial={spark.name}
            save={(name) => remoteSparksApi.rename(spark.id, name)}
            onDone={finishRename}
          />
        ) : (
          <>
            <div className="ph-device-line">
              <b>{spark.name}</b>
              <SparkStatus spark={spark} />
            </div>
            <span className="ph-device-summary">
              {spark.hostname} · {lastOpenedLine(spark, now)}
            </span>
          </>
        )}
      </div>
      {icon.field}
      {!renaming && (
        <div className="rs-actions">
          <button
            type="button"
            className="btn primary sm"
            aria-label={`Open ${spark.name}`}
            disabled={open.isPending}
            onClick={() => open.mutate()}
          >
            Open
          </button>
          <ActionsMenu label={`Actions for ${spark.name}`} buttonRef={actions.button}>
            {(dismiss) => (
              <>
                <MenuItem
                  label="Rename"
                  onSelect={() => {
                    dismiss();
                    setRenaming(true);
                  }}
                />
                <MenuItem
                  label={CHANGE_ICON_ITEM}
                  onSelect={() => {
                    dismiss();
                    actions.button.current?.focus();
                    icon.choose();
                  }}
                />
                {spark.icon !== null && (
                  <MenuItem
                    label={REMOVE_ICON_ITEM}
                    onSelect={() => {
                      dismiss();
                      actions.button.current?.focus();
                      icon.remove();
                    }}
                  />
                )}
                <hr />
                <MenuItem
                  danger
                  label="Remove…"
                  onSelect={() => {
                    dismiss();
                    if (actions.button.current) onRemove(spark, actions.button.current);
                  }}
                />
              </>
            )}
          </ActionsMenu>
        </div>
      )}
      {problem && (
        <p className="ph-error rs-row-note" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}
