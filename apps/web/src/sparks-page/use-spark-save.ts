import { useState } from 'react';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateTeammateRequest } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { teammateKeys, teammatesApi } from '../teammates/teammates-api.ts';

const saveKey = (sparkId: string) => ['spark-save', sparkId] as const;

function useRefreshSparks() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: teammateKeys.all }),
      client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
    ]);
}

export function useSparkSave(sparkId: string) {
  const refresh = useRefreshSparks();
  return useMutation({
    mutationKey: saveKey(sparkId),
    mutationFn: (update: UpdateTeammateRequest) => teammatesApi.update(sparkId, update),
    onSuccess: refresh,
  });
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function useSparkSaveState(sparkId: string): SaveState {
  const [since] = useState(() => Date.now());
  const statuses = useMutationState({
    filters: {
      mutationKey: saveKey(sparkId),
      predicate: (mutation) => mutation.state.submittedAt >= since,
    },
    select: (mutation) => mutation.state.status,
  });
  if (statuses.includes('pending')) return 'saving';
  const last = statuses.at(-1);
  if (last === 'error') return 'failed';
  return last === 'success' ? 'saved' : 'idle';
}

export function useSetDefaultSpark() {
  const refresh = useRefreshSparks();
  return useMutation({
    mutationFn: (sparkId: string | null) => teammatesApi.setDefault(sparkId),
    onSuccess: refresh,
  });
}

export function useSparkUsage(sparkId: string, enabled = true) {
  return useQuery({
    queryKey: teammateKeys.usage(sparkId),
    queryFn: () => teammatesApi.usage(sparkId),
    enabled,
  });
}
