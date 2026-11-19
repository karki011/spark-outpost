import './run-view.css';
import type { WorkflowRun } from '@spark-outpost/contracts';
import { ForwardIcon } from '../ui/icons.tsx';
import { openWorkflowRun } from './run-route.ts';
import { RunState } from './RunState.tsx';
import { useWorkflowRunOfTurn } from './use-workflow-runs.ts';

export function useTurnWorkflowRun(turnRunId: string, enabled = true): WorkflowRun | null {
  return useWorkflowRunOfTurn(turnRunId, enabled).data ?? null;
}

export function OpenRunViewButton({ run, quiet = false }: { run: WorkflowRun; quiet?: boolean }) {
  return (
    <button
      type="button"
      className={quiet ? 'btn ghost sm' : 'btn line sm'}
      onClick={() => openWorkflowRun(run.id)}
    >
      Open run view
      <ForwardIcon />
    </button>
  );
}

export function WorkflowRunLink({ turnRunId }: { turnRunId: string }) {
  const run = useTurnWorkflowRun(turnRunId);
  if (!run) return null;
  return (
    <p className="wf-run-link">
      <span>Workflow {run.workflowName}</span>
      <RunState status={run.status} />
      <OpenRunViewButton run={run} />
    </p>
  );
}
