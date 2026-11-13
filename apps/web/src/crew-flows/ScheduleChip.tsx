import { hourCycle } from '../desktop/hour-cycle.ts';
import { ClockIcon } from '../ui/icons.tsx';
import { scheduleSummary } from './schedule-model.ts';
import { useWorkflowSchedules } from './use-schedule.ts';

export function ScheduleChip({ workflowId }: { workflowId: string }) {
  const schedules = useWorkflowSchedules();
  const found = schedules.data?.find((entry) => entry.workflowId === workflowId);
  if (!found?.schedule.enabled) return null;
  return (
    <span className="wf-tag wf-sched-chip">
      <ClockIcon />
      {scheduleSummary(found.schedule, hourCycle())}
    </span>
  );
}
