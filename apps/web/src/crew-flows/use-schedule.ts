import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowSchedule } from '@spark-outpost/contracts';
import { scheduleApi, scheduleKeys } from './schedule-api.ts';

export function useWorkflowSchedules() {
  return useQuery({ queryKey: scheduleKeys.all, queryFn: scheduleApi.list });
}

export function useWorkflowSchedule(id: string, enabled: boolean) {
  return useQuery({
    queryKey: scheduleKeys.one(id),
    queryFn: () => scheduleApi.get(id),
    enabled,
  });
}

export function useSaveSchedule(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (schedule: WorkflowSchedule) => scheduleApi.save(id, schedule),
    onSuccess: async (view) => {
      client.setQueryData(scheduleKeys.one(id), view);
      await client.invalidateQueries({ queryKey: scheduleKeys.all, exact: true });
    },
  });
}
