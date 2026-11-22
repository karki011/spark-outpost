import { useQuery } from '@tanstack/react-query';
import type { WorkflowRun } from '@spark-outpost/contracts';
import { hourCycle } from '../desktop/hour-cycle.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { activityRows, type ActivityRow } from './activity-model.ts';
import { workflowRunKeys, workflowRunsApi } from './runs-api.ts';
import { scheduleApi, scheduleKeys } from './schedule-api.ts';
import { useWorkflowTriggers } from './use-triggers.ts';

const ACTIVITY_REFRESH_MS = 30_000;

export interface WorkflowActivity {
  rows: ActivityRow[];
  runs: readonly WorkflowRun[];
  loading: boolean;
  error: Error | null;
}

export function useWorkflowActivity(workflowId: string, saved: boolean): WorkflowActivity {
  const now = new Date(useMinuteClock());
  const runs = useQuery({
    queryKey: workflowRunKeys.list(workflowId),
    queryFn: () => workflowRunsApi.list(workflowId),
    refetchInterval: ACTIVITY_REFRESH_MS,
    enabled: saved,
  });
  const slots = useQuery({
    queryKey: scheduleKeys.slots(workflowId),
    queryFn: () => scheduleApi.slots(workflowId),
    refetchInterval: ACTIVITY_REFRESH_MS,
    enabled: saved,
  });
  const triggers = useWorkflowTriggers(workflowId, saved);
  const rows = activityRows(
    {
      runs: runs.data ?? [],
      slots: slots.data ?? [],
      events: triggers.data?.events ?? [],
      holds: triggers.data?.holds ?? [],
    },
    now,
    hourCycle(),
  );
  return {
    rows,
    runs: runs.data ?? [],
    loading: saved && (runs.isPending || slots.isPending || triggers.isPending),
    error: runs.error ?? slots.error ?? triggers.error,
  };
}
