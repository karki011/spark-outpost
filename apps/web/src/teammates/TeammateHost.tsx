import { AnimatePresence } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/client.ts';
import { GracePeriodBar } from '../ui/GracePeriodBar.tsx';
import '../ui/toast.css';
import { TeammateSheet } from './TeammateSheet.tsx';
import {
  clearTeammateDelete,
  reportTeammateDeleteProblem,
  useTeammateUi,
  type PendingDelete,
} from './teammate-store.ts';
import { teammateKeys, teammatesApi } from './teammates-api.ts';
import { useTeammates } from './use-teammates.ts';

const GRACE_SECONDS = 10;

function DeleteGrace({ pending }: { pending: PendingDelete }) {
  const client = useQueryClient();
  const remove = async () => {
    try {
      await teammatesApi.remove(pending.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The server could not be reached.';
      reportTeammateDeleteProblem(`${pending.name} wasn’t deleted. ${reason}`);
    } finally {
      clearTeammateDelete();
      await Promise.all([
        client.invalidateQueries({ queryKey: teammateKeys.all }),
        client.invalidateQueries({ queryKey: queryKeys.conversations }),
      ]);
    }
  };
  return (
    <GracePeriodBar
      text={`Deleting ${pending.name}. Its chats stay.`}
      announcement={`${pending.name} will be deleted in ${GRACE_SECONDS} seconds. Press Undo or Escape to keep it.`}
      seconds={GRACE_SECONDS}
      onElapse={() => void remove()}
      onUndo={clearTeammateDelete}
    />
  );
}

export function TeammateHost() {
  const { sheet, deleting, deleteProblem } = useTeammateUi();
  const { teammates } = useTeammates();
  const editing = sheet?.kind === 'edit' ? teammates.find((entry) => entry.id === sheet.id) : null;
  const showSheet = sheet !== null && (sheet.kind === 'create' || editing);
  return (
    <>
      <AnimatePresence>
        {showSheet && (
          <TeammateSheet
            key={sheet.kind === 'edit' ? sheet.id : 'new'}
            request={sheet}
            editing={editing ?? null}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {deleting && <DeleteGrace key={deleting.id} pending={deleting} />}
      </AnimatePresence>
      {deleteProblem && !deleting && (
        <div className="toast floating" role="alert">
          <span>{deleteProblem}</span>
          <button type="button" onClick={() => reportTeammateDeleteProblem(null)}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
