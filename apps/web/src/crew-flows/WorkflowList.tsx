import type { WorkflowRun, WorkflowSummary } from '@spark-outpost/contracts';
import { PlusIcon, ResumeIcon, WarnIcon } from '../ui/icons.tsx';
import { LastRun } from './RunsList.tsx';
import { ScheduleChip } from './ScheduleChip.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { StagePreview } from './StagePreview.tsx';
import { useStartWorkflowRun } from './use-workflows.ts';

interface WorkflowListProps {
  workflows: readonly WorkflowSummary[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  onNew: () => void;
  onEdit: (id: string) => void;
  onOpenRun: (run: WorkflowRun) => void;
}

function plural(total: number, word: string): string {
  return `${total} ${word}${total === 1 ? '' : 's'}`;
}

function WorkflowRow({
  workflow,
  sparkById,
  onEdit,
  onOpenRun,
}: Omit<WorkflowListProps, 'workflows' | 'onNew'> & { workflow: WorkflowSummary }) {
  const run = useStartWorkflowRun();
  const steps = workflow.stages.reduce((total, stage) => total + stage.length, 0);
  return (
    <li className="wf-row">
      <span className="wf-row-main">
        <b>{workflow.name}</b>
        <small>
          {plural(steps, 'step')} · {plural(workflow.stages.length, 'stage')}
        </small>
        <StagePreview stages={workflow.stages} sparks={sparkById} />
        <ScheduleChip workflowId={workflow.id} />
      </span>
      <span className="wf-row-status" role="status">
        {workflow.problems > 0 && (
          <span className="wf-state" data-state="failed">
            <WarnIcon />
            {plural(workflow.problems, 'problem')}
          </span>
        )}
        <LastRun workflowId={workflow.id} name={workflow.name} onOpen={onOpenRun} />
        {run.error && (
          <span className="wf-state" data-state="failed">
            <WarnIcon />
            {run.error.message}
          </span>
        )}
      </span>
      <button
        type="button"
        className="btn line sm"
        aria-label={`Edit ${workflow.name}`}
        onClick={() => onEdit(workflow.id)}
      >
        Edit
      </button>
      <button
        type="button"
        className="btn primary sm"
        aria-label={`Run ${workflow.name}`}
        disabled={workflow.problems > 0 || run.isPending}
        title={workflow.problems > 0 ? 'Fix its problems in the editor first' : undefined}
        onClick={() => run.mutate(workflow.id, { onSuccess: onOpenRun })}
      >
        <ResumeIcon />
        Run
      </button>
    </li>
  );
}

export function WorkflowList({
  workflows,
  sparkById,
  onNew,
  onEdit,
  onOpenRun,
}: WorkflowListProps) {
  return (
    <div className="wf-list">
      <div className="wf-list-bar">
        <button type="button" className="btn primary sm" onClick={onNew}>
          <PlusIcon />
          New workflow
        </button>
      </div>
      <ul className="wf-rows" aria-label="Workflows">
        {workflows.map((workflow) => (
          <WorkflowRow
            key={workflow.id}
            workflow={workflow}
            sparkById={sparkById}
            onEdit={onEdit}
            onOpenRun={onOpenRun}
          />
        ))}
      </ul>
    </div>
  );
}
