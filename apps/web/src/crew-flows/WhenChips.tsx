import './editor-bar.css';
import type { WorkflowSchedule } from '@spark-outpost/contracts';
import { hourCycle } from '../desktop/hour-cycle.ts';
import { ClockIcon, SparkleIcon } from '../ui/icons.tsx';
import { scheduleSummary } from './schedule-model.ts';
import { triggerLabels, type TriggerSwitches } from './triggers-model.ts';
import { useWorkflowSchedules } from './use-schedule.ts';
import { useWorkflowTriggersList } from './use-triggers.ts';

interface WhenChipsProps {
  schedule: WorkflowSchedule | null;
  triggers: TriggerSwitches | null;
}

export function WhenChips({ schedule, triggers }: WhenChipsProps) {
  const labels = triggerLabels(triggers);
  if (!schedule?.enabled && labels.length === 0) return null;
  return (
    <span className="wf-chips" role="group" aria-label="When it runs">
      {schedule?.enabled && (
        <span className="wf-tag wf-chip" data-chip="schedule">
          <ClockIcon />
          {scheduleSummary(schedule, hourCycle())}
        </span>
      )}
      {labels.map((label) => (
        <span key={label} className="wf-tag wf-chip" data-chip="trigger">
          <SparkleIcon />
          {label}
        </span>
      ))}
    </span>
  );
}

export function SavedWhenChips({ workflowId }: { workflowId: string }) {
  const schedules = useWorkflowSchedules();
  const triggers = useWorkflowTriggersList();
  return (
    <WhenChips
      schedule={schedules.data?.find((entry) => entry.workflowId === workflowId)?.schedule ?? null}
      triggers={triggers.data?.find((entry) => entry.workflowId === workflowId)?.triggers ?? null}
    />
  );
}
