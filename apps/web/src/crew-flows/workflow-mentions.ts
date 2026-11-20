import type { WorkflowSummary } from '@spark-outpost/contracts';

const PICKER_LIMIT = 6;

export function workflowsMatching(
  workflows: readonly WorkflowSummary[],
  query: string,
  sparks: readonly { name: string }[],
): WorkflowSummary[] {
  const wanted = query.toLowerCase();
  const sparkNames = new Set(sparks.map((spark) => spark.name.trim().toLowerCase()));
  const matches = (workflow: WorkflowSummary) =>
    workflow.id.startsWith(wanted) ||
    workflow.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(wanted));
  return workflows
    .filter((workflow) => !sparkNames.has(workflow.id) && matches(workflow))
    .slice(0, PICKER_LIMIT);
}
