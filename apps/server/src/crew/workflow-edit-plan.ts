import {
  CREW_SLUG_PATTERN,
  workflowProblems,
  workflowSchema,
  workflowStages,
  type CrewFileChange,
  type Workflow,
} from '@spark-outpost/contracts';
import type { WorkflowStore } from '../crew-flows/workflow-store.ts';
import type { CrewProblem } from './crew-edit-plan.ts';

export interface CrewSparkName {
  id: string;
  name: string;
}

export interface WorkflowEditPlan {
  id: string;
  name: string;
  file: CrewFileChange | null;
  stages: string[][];
  problems: CrewProblem[];
}

export const WORKFLOW_EDIT_PROBLEMS = {
  shape: 'A workflow is an object with id, name and steps.',
  broken:
    'The file for this workflow is not a valid workflow. The user can fix or delete it on the Sparks page.',
  missing: 'There is no workflow with this id.',
} as const;

export function workflowFileText(workflow: Workflow): string {
  return `${JSON.stringify(workflow, null, 2)}\n`;
}

export function workflowFilePath(id: string): string {
  return `${id}.json`;
}

function withSparkIds(raw: unknown, sparks: readonly CrewSparkName[], problems: CrewProblem[]) {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { steps?: unknown }).steps)
  ) {
    return raw;
  }
  const steps = (raw as { steps: unknown[] }).steps.map((step) => {
    if (typeof step !== 'object' || step === null) return step;
    const { spark, ...rest } = step as Record<string, unknown>;
    if (typeof spark !== 'string' || typeof rest.sparkId === 'string') return rest;
    const wanted = spark.trim().toLowerCase();
    const found = sparks.find((s) => s.id === wanted || s.name.toLowerCase() === wanted);
    if (!found) {
      problems.push({
        path: String(rest.id ?? 'steps'),
        text: `No Spark called ${spark}. Sparks: ${sparks.map((s) => s.name).join(', ') || 'none'}.`,
      });
      return rest;
    }
    return { ...rest, sparkId: found.id };
  });
  return { ...(raw as Record<string, unknown>), steps };
}

function stageNames(workflow: Workflow, sparks: readonly CrewSparkName[]): string[][] {
  const names = new Map(sparks.map((spark) => [spark.id, spark.name]));
  const sparkOf = new Map(workflow.steps.map((step) => [step.id, step.sparkId]));
  return workflowStages(workflow.steps).map((stage) =>
    stage.map((stepId) => names.get(sparkOf.get(stepId) ?? '') ?? stepId),
  );
}

function failed(id: string, problems: CrewProblem[]): WorkflowEditPlan {
  return { id, name: id, file: null, stages: [], problems };
}

export async function planWorkflowSave(
  store: WorkflowStore,
  raw: unknown,
  sparks: readonly CrewSparkName[],
): Promise<WorkflowEditPlan> {
  const problems: CrewProblem[] = [];
  const resolved = withSparkIds(raw, sparks, problems);
  const parsed = workflowSchema.safeParse(resolved);
  const rawId = String((raw as { id?: unknown } | null)?.id ?? '');
  if (!parsed.success) {
    if (problems.length > 0) return failed(rawId, problems);
    return failed(
      rawId,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'workflow',
        text: issue.path.length === 0 ? WORKFLOW_EDIT_PROBLEMS.shape : issue.message,
      })),
    );
  }
  const workflow = parsed.data;
  const found = workflowProblems(workflow.steps, new Set(sparks.map((spark) => spark.id)));
  problems.push(...found.map((problem) => ({ path: problem.stepId, text: problem.text })));
  const current = await store.read(workflow.id);
  if (!current && (await store.ids()).includes(workflow.id)) {
    problems.push({ path: workflowFilePath(workflow.id), text: WORKFLOW_EDIT_PROBLEMS.broken });
  }
  if (problems.length > 0) return failed(workflow.id, problems);
  const after = workflowFileText(workflow);
  const before = current ? workflowFileText(current.workflow) : null;
  const path = workflowFilePath(workflow.id);
  const file: CrewFileChange | null =
    before === after
      ? null
      : current
        ? { path, change: 'changed', before, after, baseHash: current.hash }
        : { path, change: 'new', before: null, after, baseHash: null };
  return {
    id: workflow.id,
    name: workflow.name,
    file,
    stages: stageNames(workflow, sparks),
    problems: [],
  };
}

export async function planWorkflowRemoval(
  store: WorkflowStore,
  id: string,
  sparks: readonly CrewSparkName[],
): Promise<WorkflowEditPlan> {
  const current = CREW_SLUG_PATTERN.test(id) ? await store.read(id) : null;
  if (!current) {
    return failed(id, [{ path: workflowFilePath(id), text: WORKFLOW_EDIT_PROBLEMS.missing }]);
  }
  return {
    id,
    name: current.workflow.name,
    file: {
      path: workflowFilePath(id),
      change: 'deleted',
      before: workflowFileText(current.workflow),
      after: null,
      baseHash: current.hash,
    },
    stages: stageNames(current.workflow, sparks),
    problems: [],
  };
}
