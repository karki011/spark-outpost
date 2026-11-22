import type { WorkflowSummary } from '@spark-outpost/contracts';

export interface MentionWorkflow {
  workflow: WorkflowSummary;
  blocked: string | null;
}

const WORD_BREAK = /[\s_-]+/;

function startsWord(text: string, wanted: string): boolean {
  return text
    .toLowerCase()
    .split(WORD_BREAK)
    .some((word) => word.startsWith(wanted));
}

export function mentionBlock(
  workflow: WorkflowSummary,
  sparks: readonly { name: string }[],
): string | null {
  if (workflow.problems > 0) return 'Has problems, so it can’t run yet';
  const taken = sparks.some((spark) => spark.name.trim().toLowerCase() === workflow.id);
  return taken ? 'A Spark has this name, so @ goes to the Spark' : null;
}

export function workflowsMatching(
  workflows: readonly WorkflowSummary[],
  query: string,
  sparks: readonly { name: string }[],
): MentionWorkflow[] {
  const wanted = query.toLowerCase();
  return workflows
    .filter(
      (workflow) =>
        workflow.id.startsWith(wanted) ||
        startsWord(workflow.id, wanted) ||
        startsWord(workflow.name, wanted),
    )
    .map((workflow) => ({ workflow, blocked: mentionBlock(workflow, sparks) }));
}
