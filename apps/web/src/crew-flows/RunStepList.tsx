import type { WorkflowRunStep } from '@spark-outpost/contracts';
import { stepElapsed } from './run-model.ts';
import { RunStepState } from './RunState.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { SparkDot } from './StagePreview.tsx';

interface RunStepListProps {
  steps: readonly WorkflowRunStep[];
  labels: ReadonlyMap<string, string>;
  sparkById: ReadonlyMap<string, CrewSpark>;
  asking: ReadonlySet<string>;
  selected: string | null;
  now: number;
  onSelect: (stepId: string) => void;
}

export function RunStepList({
  steps,
  labels,
  sparkById,
  asking,
  selected,
  now,
  onSelect,
}: RunStepListProps) {
  return (
    <ul className="wf-run-steps" aria-label="All steps">
      {steps.map((step) => {
        const elapsed = stepElapsed(step, now);
        return (
          <li key={step.stepId}>
            <button
              type="button"
              className="wf-run-step"
              aria-current={selected === step.stepId ? 'true' : undefined}
              onClick={() => onSelect(step.stepId)}
            >
              <SparkDot spark={sparkById.get(step.sparkId)} size={22} />
              <span className="wf-run-step-name">{labels.get(step.stepId) ?? step.stepId}</span>
              {elapsed && <span className="wf-run-step-time">{elapsed}</span>}
              <RunStepState state={step.state} asking={asking.has(step.stepId)} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
