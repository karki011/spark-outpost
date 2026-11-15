import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowTriggers } from '@spark-outpost/contracts';
import { triggerKeys, triggersApi } from './triggers-api.ts';

const EVENTS_REFRESH_MS = 30_000;

export function useWorkflowTriggers(id: string) {
  return useQuery({
    queryKey: triggerKeys.one(id),
    queryFn: () => triggersApi.get(id),
    refetchInterval: EVENTS_REFRESH_MS,
  });
}

export function useSaveTriggers(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (triggers: WorkflowTriggers) => triggersApi.save(id, triggers),
    onSuccess: (view) => client.setQueryData(triggerKeys.one(id), view),
  });
}

export function useReleaseHold(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (holdId: string) => triggersApi.release(holdId),
    onSuccess: () => client.invalidateQueries({ queryKey: triggerKeys.one(id) }),
  });
}
