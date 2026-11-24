import {
  expandWorkflow,
  nestedWorkflowProblems,
  usedWorkflowIds,
  type ExpandedWorkflow,
  type FindWorkflow,
  type Workflow,
  type WorkflowProblem,
} from '@spark-outpost/contracts';
import type { WorkflowStore } from './workflow-store.ts';

type WorkflowReader = Pick<WorkflowStore, 'read'>;

export async function workflowFinder(
  store: WorkflowReader,
  workflow: Workflow,
): Promise<FindWorkflow> {
  const known = new Map<string, Workflow | null>([[workflow.id, workflow]]);
  let pending = usedWorkflowIds(workflow);
  while (pending.length > 0) {
    const next: string[] = [];
    for (const id of pending) {
      if (known.has(id)) continue;
      const found = (await store.read(id))?.workflow ?? null;
      known.set(id, found);
      if (found) next.push(...usedWorkflowIds(found));
    }
    pending = next;
  }
  return (id) => known.get(id) ?? null;
}

export type Runnable =
  | { workflow: ExpandedWorkflow; problems: readonly [] }
  | { workflow: null; problems: readonly [WorkflowProblem, ...WorkflowProblem[]] };

export async function runnableWorkflow(
  store: WorkflowReader,
  workflow: Workflow,
  sparkIds: ReadonlySet<string>,
): Promise<Runnable> {
  const find = await workflowFinder(store, workflow);
  const [first, ...rest] = nestedWorkflowProblems(workflow, sparkIds, find);
  if (first) return { workflow: null, problems: [first, ...rest] };
  return { workflow: expandWorkflow(workflow, find), problems: [] };
}
