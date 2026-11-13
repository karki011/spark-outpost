import './run-view.css';
import { findSparkMentions } from '@spark-outpost/contracts';
import { ForwardIcon } from '../ui/icons.tsx';
import { openWorkflowRun } from './run-route.ts';
import { RunState } from './RunState.tsx';
import { useWorkflowRuns } from './use-workflow-runs.ts';
import { useWorkflows } from './use-workflows.ts';

interface WorkflowRunLinkProps {
  turnRunId: string;
  message: string;
}

export function WorkflowRunLink({ turnRunId, message }: WorkflowRunLinkProps) {
  const workflows = useWorkflows();
  const names = (workflows.data ?? []).map((workflow) => ({ name: workflow.id }));
  const workflowId = findSparkMentions(message, names)[0]?.spark.name ?? null;
  const runs = useWorkflowRuns(workflowId);
  const run = runs.data?.find((entry) => entry.runId === turnRunId);
  if (!run) return null;
  return (
    <p className="wf-run-link">
      <span>Workflow {run.workflowName}</span>
      <RunState status={run.status} />
      <button type="button" className="btn line sm" onClick={() => openWorkflowRun(run.id)}>
        Open run view
        <ForwardIcon />
      </button>
    </p>
  );
}
