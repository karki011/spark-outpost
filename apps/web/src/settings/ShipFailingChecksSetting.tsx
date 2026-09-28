import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';

export const SHIP_FAILING_CHECKS_HINT =
  'When the project checks still fail after the fix turns, Full auto opens the draft PR anyway and marks it "Checks failing". Turn this off to stop at the keep card instead. Full auto never merges.';

export function ShipFailingChecksSetting({ enabled }: { enabled: boolean }) {
  const hintId = useId();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (value: boolean) => setupApi.updateProfile({ shipFailingChecks: value }),
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
        <span>Full auto opens a draft PR when checks still fail</span>
      </label>
      <p id={hintId} className="set-hint" aria-live="polite">
        {save.isError ? save.error.message : SHIP_FAILING_CHECKS_HINT}
      </p>
    </div>
  );
}
