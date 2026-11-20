import type { WorkflowSummary } from '@spark-outpost/contracts';

const PICKER_LIMIT = 6;

export function workflowsMatching(
  workflows: readonly WorkflowSummary[],
  query: string,
): WorkflowSummary[] {
  const wanted = query.toLowerCase();
  const matches = (workflow: WorkflowSummary) =>
    workflow.id.startsWith(wanted) ||
    workflow.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(wanted));
  return workflows.filter(matches).slice(0, PICKER_LIMIT);
}
