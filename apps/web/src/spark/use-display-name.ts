import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';

const SAVE_DELAY_MS = 350;

export function useDisplayNameSave() {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<string | null>(null);
  const save = useMutation({
    mutationFn: (value: string) => setupApi.updateProfile({ displayName: value }),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });

  useEffect(() => {
    const scheduled = timer;
    const unsaved = pending;
    return () => {
      clearTimeout(scheduled.current);
      if (unsaved.current === null) return;
      void setupApi
        .updateProfile({ displayName: unsaved.current })
        .then((state) => queryClient.setQueryData(setupKey, state));
    };
  }, [queryClient]);

  const schedule = (value: string) => {
    clearTimeout(timer.current);
    pending.current = value.trim() === '' ? null : value;
    if (pending.current === null) return;
    timer.current = setTimeout(() => {
      pending.current = null;
      save.mutate(value);
    }, SAVE_DELAY_MS);
  };

  return {
    schedule,
    error: save.isError ? save.error.message : null,
    saving: save.isPending,
  };
}
