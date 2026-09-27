import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';

export const JEV_DIFFS_DISCLOSURE =
  'Sends the diff and file paths of each proposed edit, and the final diff of a change, to TypeSafe for observation-only checks that never block or allow anything. TypeSafe does not train on it.';

export function JevDiffsSetting({ enabled }: { enabled: boolean }) {
  const hintId = useId();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (value: boolean) => setupApi.updateProfile({ jevDiffs: value }),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });
  const checked = save.isPending ? save.variables : enabled;
  return (
    <div className="field">
      <label className="check-row">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          aria-describedby={hintId}
          onChange={(event) => save.mutate(event.target.checked)}
        />
        <span>Send code diffs to Jev for safety checks</span>
      </label>
      <p id={hintId} className="set-hint" aria-live="polite">
        {save.isError ? save.error.message : JEV_DIFFS_DISCLOSURE}
      </p>
    </div>
  );
}
