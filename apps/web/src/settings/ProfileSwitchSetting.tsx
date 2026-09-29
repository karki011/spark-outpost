import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateProfileRequest } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';

interface ProfileSwitchSettingProps {
  enabled: boolean;
  label: string;
  hint: string;
  toUpdate: (value: boolean) => UpdateProfileRequest;
}

export function ProfileSwitchSetting({
  enabled,
  label,
  hint,
  toUpdate,
}: ProfileSwitchSettingProps) {
  const hintId = useId();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (value: boolean) => setupApi.updateProfile(toUpdate(value)),
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
        <span>{label}</span>
      </label>
      <p id={hintId} className="set-hint" aria-live="polite">
        {save.isError ? save.error.message : hint}
      </p>
    </div>
  );
}
