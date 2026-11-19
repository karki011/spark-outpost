import './run-view.css';
import { findSparkMentions, type WorkflowRun } from '@spark-outpost/contracts';
import { ForwardIcon } from '../ui/icons.tsx';
import { openWorkflowRun } from './run-route.ts';
import { RunState } from './RunState.tsx';
import { useWorkflowRuns } from './use-workflow-runs.ts';
import { useWorkflows } from './use-workflows.ts';

interface WorkflowRunLinkProps {
  turnRunId: string;
  message: string;
}

export function useTurnWorkflowRun(turnRunId: string, message: string): WorkflowRun | null {
  const workflows = useWorkflows();
  const names = (workflows.data ?? []).map((workflow) => ({ name: workflow.id }));
  const workflowId = findSparkMentions(message, names)[0]?.spark.name ?? null;
  const runs = useWorkflowRuns(workflowId);
  return runs.data?.find((entry) => entry.runId === turnRunId) ?? null;
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

export function WorkflowRunLink({ turnRunId, message }: WorkflowRunLinkProps) {
  const run = useTurnWorkflowRun(turnRunId, message);
  if (!run) return null;
  return (
    <p className="wf-run-link">
      <span>Workflow {run.workflowName}</span>
      <RunState status={run.status} />
      <OpenRunViewButton run={run} />
    </p>
  );
}
