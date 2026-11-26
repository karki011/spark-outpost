import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LOCAL_SPARK_ID, type LocalSpark } from '@spark-outpost/contracts';
import { MenuItem } from '../conversations/MenuShell.tsx';
import { hostWords } from '../desktop/host-words.ts';
import { ActionsMenu, useActionsButton } from './ActionsMenu.tsx';
import { remoteSparkKeys, remoteSparksApi } from './remote-sparks-api.ts';
import {
  CHANGE_ICON_ITEM,
  REMOVE_ICON_ITEM,
  USE_COMPUTER_NAME_ITEM,
  localSparkNote,
  thisComputer,
} from './remote-sparks-copy.ts';
import { RenameForm } from './RenameForm.tsx';
import { SparkIcon } from './SparkIcon.tsx';
import { ROW_ICON_SIZE } from './SparkRow.tsx';
import { useSparkIcon } from './use-spark-icon.tsx';

export function LocalSparkRow({ local }: { local: LocalSpark }) {
  const queryClient = useQueryClient();
  const actions = useActionsButton();
  const computer = hostWords().computer;
  const here = thisComputer(computer);
  const icon = useSparkIcon(LOCAL_SPARK_ID, here);
  const [renaming, setRenaming] = useState(false);
  const clearName = useMutation({
    mutationFn: () => remoteSparksApi.renameLocal(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all }),
  });
  const finishRename = () => {
    setRenaming(false);
    actions.focus();
  };
  const name = local.name ?? local.defaultName;
  const problem = clearName.error?.message ?? icon.problem;
  return (
    <li className="rs-row">
      <SparkIcon icon={local.icon} size={ROW_ICON_SIZE} name={local.name} />
      <div className="ph-device-body rs-body">
        {renaming ? (
          <RenameForm
            label={`New name for ${here}`}
            initial={local.name ?? ''}
            allowEmpty
            save={(next) => remoteSparksApi.renameLocal(next === '' ? null : next)}
            onDone={finishRename}
          />
        ) : (
          <>
            <div className="ph-device-line">
              <b>{name}</b>
              {name !== here && <span className="rs-local-tag">{here}</span>}
            </div>
            <span className="ph-device-summary">{localSparkNote(computer)}</span>
          </>
        )}
      </div>
      {icon.field}
      {!renaming && (
        <div className="rs-actions">
          <ActionsMenu label={`Actions for ${here}`} buttonRef={actions.button}>
            {(dismiss) => (
              <>
                <MenuItem
                  label="Rename"
                  onSelect={() => {
                    dismiss();
                    setRenaming(true);
                  }}
                />
                {local.name !== null && (
                  <MenuItem
                    label={USE_COMPUTER_NAME_ITEM}
                    onSelect={() => {
                      dismiss();
                      actions.button.current?.focus();
                      clearName.mutate();
                    }}
                  />
                )}
                <MenuItem
                  label={CHANGE_ICON_ITEM}
                  onSelect={() => {
                    dismiss();
                    actions.button.current?.focus();
                    icon.choose();
                  }}
                />
                {local.icon !== null && (
                  <MenuItem
                    label={REMOVE_ICON_ITEM}
                    onSelect={() => {
                      dismiss();
                      actions.button.current?.focus();
                      icon.remove();
                    }}
                  />
                )}
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
