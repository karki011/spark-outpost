import { useWorkflows } from '../crew-flows/use-workflows.ts';
import { WorkflowsPanel } from '../crew-flows/WorkflowsPanel.tsx';

export function useWorkflowCount(): number | null {
  return useWorkflows().data?.length ?? null;
}

export function WorkflowsTab() {
  return <WorkflowsPanel />;
}
