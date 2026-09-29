import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateProfileRequest } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';

export function useProfileSetting<T>(saved: T, toUpdate: (value: T) => UpdateProfileRequest) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (value: T) => setupApi.updateProfile(toUpdate(value)),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });
  return {
    value: save.isPending ? save.variables : saved,
    error: save.isError ? save.error.message : null,
    set: (value: T) => save.mutate(value),
  };
}
