import { z } from 'zod';
import { crewSlugSchema } from './crew-files.ts';
import {
  WORKFLOW_NAME_MAX,
  workflowFailureSchema,
  workflowJoinSchema,
  workflowProblems,
  type Workflow,
  type WorkflowProblem,
} from './crew-workflow.ts';

export const WORKFLOW_RUN_STEPS_MAX = 500;
export const RUN_STEP_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}(\.[a-z][a-z0-9-]{1,39})*$/;
export const runStepIdSchema = z.string().regex(RUN_STEP_ID_PATTERN);

export const expandedStepSchema = z.object({
  id: runStepIdSchema,
  sparkId: z.uuid(),
  prompt: z.string().default(''),
  dependsOn: z.array(runStepIdSchema).default([]),
  join: workflowJoinSchema.default('all'),
  onFailure: workflowFailureSchema.default('stop'),
});
export type ExpandedStep = z.infer<typeof expandedStepSchema>;

export const expandedWorkflowSchema = z.object({
  id: crewSlugSchema,
  name: z.string().trim().min(1).max(WORKFLOW_NAME_MAX),
  steps: z.array(expandedStepSchema).min(1),
});
export type ExpandedWorkflow = z.infer<typeof expandedWorkflowSchema>;

export type FindWorkflow = (id: string) => Workflow | null;

export class WorkflowMissingError extends Error {
  constructor(id: string) {
    super(`There is no workflow called ${id}.`);
  }
}

export function usedWorkflowIds(workflow: Pick<Workflow, 'steps'>): string[] {
  const ids = workflow.steps.flatMap((step) =>
    step.workflowId === undefined ? [] : [step.workflowId],
  );
  return [...new Set(ids)];
}

function reaches(from: Workflow, target: string, find: FindWorkflow, seen: Set<string>): boolean {
  for (const id of usedWorkflowIds(from)) {
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const next = find(id);
    if (next && reaches(next, target, find, seen)) return true;
  }
  return false;
}

function runSteps(workflow: Workflow, find: FindWorkflow, sizes: Map<string, number>): number {
  const known = sizes.get(workflow.id);
  if (known !== undefined) return known;
  let count = 0;
  for (const step of workflow.steps) {
    const inner = step.workflowId === undefined ? null : find(step.workflowId);
    count += inner ? runSteps(inner, find, sizes) : 1;
  }
  sizes.set(workflow.id, count);
  return count;
}

interface UseProblem {
  kind: WorkflowProblem['kind'];
  says: string;
}

function useProblem(
  workflow: Workflow,
  usedId: string,
  sparkIds: ReadonlySet<string>,
  find: FindWorkflow,
): UseProblem | null {
  if (usedId === workflow.id) {
    return { kind: 'workflow_cycle', says: 'runs this workflow inside itself.' };
  }
  const inner = find(usedId);
  if (!inner) return { kind: 'unknown_workflow', says: 'uses a workflow that no longer exists.' };
  if (reaches(inner, workflow.id, find, new Set())) {
    return { kind: 'workflow_cycle', says: `uses ${inner.name}, which uses this workflow.` };
  }
  const [first] = nestedWorkflowProblems(inner, sparkIds, find);
  if (!first) return null;
  return { kind: 'inner_problem', says: `uses ${inner.name}, which has a problem: ${first.text}` };
}

function nestingProblems(
  workflow: Workflow,
  sparkIds: ReadonlySet<string>,
  find: FindWorkflow,
): WorkflowProblem[] {
  const checked = new Map<string, UseProblem | null>();
  const problems: WorkflowProblem[] = [];
  for (const step of workflow.steps) {
    if (step.workflowId === undefined) continue;
    if (!checked.has(step.workflowId)) {
      checked.set(step.workflowId, useProblem(workflow, step.workflowId, sparkIds, find));
    }
    const found = checked.get(step.workflowId);
    if (found)
      problems.push({ kind: found.kind, stepId: step.id, text: `${step.id} ${found.says}` });
  }
  return problems;
}

export function nestedWorkflowProblems(
  workflow: Workflow,
  sparkIds: ReadonlySet<string>,
  find: FindWorkflow,
): WorkflowProblem[] {
  const problems = [
    ...workflowProblems(workflow.steps, sparkIds),
    ...nestingProblems(workflow, sparkIds, find),
  ];
  if (problems.length > 0) return problems;
  const firstUse = workflow.steps.find((step) => step.workflowId !== undefined);
  if (firstUse && runSteps(workflow, find, new Map()) > WORKFLOW_RUN_STEPS_MAX) {
    return [
      {
        kind: 'too_many_steps',
        stepId: firstUse.id,
        text: `With the workflows it uses, this workflow has more than ${WORKFLOW_RUN_STEPS_MAX} steps.`,
      },
    ];
  }
  return [];
}

function expandSteps(workflow: Workflow, find: FindWorkflow): ExpandedStep[] {
  const lastSteps = new Map<string, string[]>();
  const flat: ExpandedStep[] = [];
  for (const step of workflow.steps) {
    if (step.sparkId !== undefined) {
      flat.push({
        id: step.id,
        sparkId: step.sparkId,
        prompt: step.prompt,
        dependsOn: [...step.dependsOn],
        join: step.join,
        onFailure: step.onFailure,
      });
      continue;
    }
    const inner = step.workflowId === undefined ? null : find(step.workflowId);
    if (!inner) throw new WorkflowMissingError(step.workflowId ?? step.id);
    const innerSteps = expandSteps(inner, find);
    const waitedOn = new Set(innerSteps.flatMap((innerStep) => innerStep.dependsOn));
    lastSteps.set(
      step.id,
      innerSteps
        .filter((innerStep) => !waitedOn.has(innerStep.id))
        .map((innerStep) => `${step.id}.${innerStep.id}`),
    );
    for (const innerStep of innerSteps) {
      const startsFirst = innerStep.dependsOn.length === 0;
      flat.push({
        id: `${step.id}.${innerStep.id}`,
        sparkId: innerStep.sparkId,
        prompt: [step.prompt, innerStep.prompt].filter((text) => text.trim() !== '').join('\n\n'),
        dependsOn: startsFirst
          ? [...step.dependsOn]
          : innerStep.dependsOn.map((parent) => `${step.id}.${parent}`),
        join: startsFirst ? step.join : innerStep.join,
        onFailure: step.onFailure === 'continue' ? 'continue' : innerStep.onFailure,
      });
    }
  }
  return flat.map((step) => ({
    ...step,
    dependsOn: [...new Set(step.dependsOn.flatMap((parent) => lastSteps.get(parent) ?? [parent]))],
  }));
}

export function expandWorkflow(workflow: Workflow, find: FindWorkflow): ExpandedWorkflow {
  return { id: workflow.id, name: workflow.name, steps: expandSteps(workflow, find) };
}
