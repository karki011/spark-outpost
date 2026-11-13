import type { WorkflowRunStatus, WorkflowStepState } from '@spark-outpost/contracts';
import { BellIcon, CheckIcon, InfoIcon, MinusIcon, ResumeIcon, XIcon } from '../ui/icons.tsx';
import { NEEDS_YOU, RUN_WORDS } from './run-model.ts';
import { StepState } from './StepState.tsx';

function RunIcon({ status }: { status: WorkflowRunStatus }) {
  if (status === 'succeeded') return <CheckIcon className="wf-state-ic" />;
  if (status === 'failed') return <XIcon />;
  if (status === 'cancelled') return <MinusIcon />;
  if (status === 'outcome_unknown') return <InfoIcon />;
  return <ResumeIcon />;
}

export function RunState({ status }: { status: WorkflowRunStatus }) {
  return (
    <span className="wf-state" data-state={status}>
      <RunIcon status={status} />
      {RUN_WORDS[status]}
    </span>
  );
}

export function RunStepState({ state, asking }: { state: WorkflowStepState; asking: boolean }) {
  if (!asking) return <StepState state={state} />;
  return (
    <span className="wf-state" data-state="asking">
      <BellIcon />
      {NEEDS_YOU}
    </span>
  );
}
