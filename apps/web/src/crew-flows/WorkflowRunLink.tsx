import './run-view.css';
import type { WorkflowRun } from '@spark-outpost/contracts';
import { ForwardIcon } from '../ui/icons.tsx';
import { openWorkflowRun } from './run-route.ts';

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
