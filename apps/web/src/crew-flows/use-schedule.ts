import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowSchedule } from '@spark-outpost/contracts';
import { scheduleApi, scheduleKeys } from './schedule-api.ts';

const HISTORY_REFRESH_MS = 30_000;

export function useWorkflowSchedules() {
  return useQuery({ queryKey: scheduleKeys.all, queryFn: scheduleApi.list });
}

export function useWorkflowSchedule(id: string) {
  return useQuery({ queryKey: scheduleKeys.one(id), queryFn: () => scheduleApi.get(id) });
}

export function useScheduleHistory(id: string) {
  return useQuery({
    queryKey: scheduleKeys.history(id),
    queryFn: () => scheduleApi.history(id),
    refetchInterval: HISTORY_REFRESH_MS,
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
