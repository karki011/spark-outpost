import './run-view.css';
import type { WorkflowRun } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { latestRun } from './run-model.ts';
import { RunState } from './RunState.tsx';
import { useWorkflowRuns } from './use-workflow-runs.ts';

interface LastRunProps {
  workflowId: string;
  name: string;
  onOpen: (run: WorkflowRun) => void;
}

export function LastRun({ workflowId, name, onOpen }: LastRunProps) {
  const runs = useWorkflowRuns(workflowId);
  if (!runs.data) return null;
  const last = latestRun(runs.data);
  if (!last) return <span className="wf-hint">Not run yet</span>;
  return (
    <button
      type="button"
      className="wf-last-run"
      aria-label={`Open the last run of ${name}`}
      onClick={() => onOpen(last)}
    >
      <RunState status={last.status} />
      <span>{relativeTime(last.startedAt)}</span>
    </button>
  );
}
