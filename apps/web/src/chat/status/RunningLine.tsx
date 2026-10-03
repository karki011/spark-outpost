import { useTooltip } from '../../ui/Tooltip.tsx';
import { Dot, WorkerFace } from './line-parts.tsx';
import type { StepActivity } from './step-activity.ts';
import { clockText } from './status-text.ts';
import type { Worker } from './status-store.ts';
import { SLOW_STEP_MS, useNow } from './use-status-line.ts';

function busyStep(activity: StepActivity | null): StepActivity | null {
  return activity && activity.kind !== 'think' ? activity : null;
}

function whoText(worker: Worker, step: StepActivity | null): string {
  if (step) return `${worker.name} is working`;
  return `${worker.name} is ${worker.kind === 'lead' ? 'planning' : 'thinking'}…`;
}

export function runningText(worker: Worker, activity: StepActivity | null): string {
  const step = busyStep(activity);
  const who = whoText(worker, step);
  if (!step) return who;
  return `${who}: ${step.target ? `${step.verb} ${step.target}` : step.verb}`;
}

export function RunningLine({
  worker,
  activity,
  since,
}: {
  worker: Worker;
  activity: StepActivity | null;
  since: number | null;
}) {
  const step = busyStep(activity);
  const now = useNow(since !== null);
  const elapsed = since === null ? 0 : now - since;
  const tip = useTooltip(step?.full ?? whoText(worker, step), { side: 'top' });
  return (
    <p className="cs-line run">
      <WorkerFace worker={worker} idle={!step} />
      <span className="cs-word">{whoText(worker, step)}</span>
      {step && (
        <>
          <Dot />
          <span className="cs-what" {...tip.triggerProps}>
            {step.verb}
            {step.target && <> {step.code ? <code>{step.target}</code> : step.target}</>}
          </span>
        </>
      )}
      {elapsed >= SLOW_STEP_MS && (
        <>
          <Dot />
          <span className="cs-time">{clockText(elapsed)}</span>
        </>
      )}
      {tip.tooltip}
    </p>
  );
}
