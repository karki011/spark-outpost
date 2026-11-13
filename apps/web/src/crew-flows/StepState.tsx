import type { WorkflowStepState } from '@spark-outpost/contracts';
import { CheckIcon, ClockIcon, MinusIcon, XIcon } from '../ui/icons.tsx';

const WORDS: Record<WorkflowStepState, string> = {
  waiting: 'Waiting',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

function StateIcon({ state }: { state: WorkflowStepState }) {
  if (state === 'succeeded') return <CheckIcon className="wf-state-ic" />;
  if (state === 'failed') return <XIcon />;
  if (state === 'skipped' || state === 'cancelled') return <MinusIcon />;
  return <ClockIcon />;
}

export function StepState({ state }: { state: WorkflowStepState }) {
  return (
    <span className="wf-state" data-state={state}>
      <StateIcon state={state} />
      {WORDS[state]}
    </span>
  );
}
