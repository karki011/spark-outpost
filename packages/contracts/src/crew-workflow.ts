import { z } from 'zod';
import { crewSlugSchema } from './crew-files.ts';

export const WORKFLOW_NAME_MAX = 60;
export const WORKFLOW_STEPS_MAX = 100;
export const WORKFLOW_PROMPT_MAX = 4000;

export const workflowJoinSchema = z.enum(['all', 'any']);
export type WorkflowJoin = z.infer<typeof workflowJoinSchema>;

export const workflowFailureSchema = z.enum(['stop', 'continue']);
export type WorkflowFailure = z.infer<typeof workflowFailureSchema>;

export const workflowStepSchema = z.object({
  id: crewSlugSchema,
  sparkId: z.uuid(),
  prompt: z.string().max(WORKFLOW_PROMPT_MAX).default(''),
  dependsOn: z.array(crewSlugSchema).max(WORKFLOW_STEPS_MAX).default([]),
  join: workflowJoinSchema.default('all'),
  onFailure: workflowFailureSchema.default('stop'),
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const workflowSchema = z.object({
  id: crewSlugSchema,
  name: z.string().trim().min(1).max(WORKFLOW_NAME_MAX),
  steps: z.array(workflowStepSchema).min(1).max(WORKFLOW_STEPS_MAX),
});
export type Workflow = z.infer<typeof workflowSchema>;

export type WorkflowProblemKind =
  'duplicate_step' | 'unknown_step' | 'self' | 'cycle' | 'unknown_spark';

export interface WorkflowProblem {
  kind: WorkflowProblemKind;
  stepId: string;
  text: string;
}

export type StepShape = Pick<WorkflowStep, 'id' | 'dependsOn'>;
export type WorkflowProblems = (
  steps: readonly Pick<WorkflowStep, 'id' | 'dependsOn' | 'sparkId'>[],
  sparkIds: ReadonlySet<string>,
) => WorkflowProblem[];
export type WorkflowStages = (steps: readonly StepShape[]) => string[][];

function firstById<Step extends StepShape>(steps: readonly Step[]): Map<string, Step> {
  const byId = new Map<string, Step>();
  for (const step of steps) {
    if (!byId.has(step.id)) byId.set(step.id, step);
  }
  return byId;
}

function duplicateProblems(steps: readonly StepShape[]): WorkflowProblem[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const problems: WorkflowProblem[] = [];
  for (const { id } of steps) {
    if (seen.has(id) && !reported.has(id)) {
      reported.add(id);
      problems.push({ kind: 'duplicate_step', stepId: id, text: `Two steps are called ${id}.` });
    }
    seen.add(id);
  }
  return problems;
}

function dependencyProblems(step: StepShape, known: ReadonlyMap<string, StepShape>) {
  const problems: WorkflowProblem[] = [];
  for (const parent of new Set(step.dependsOn)) {
    if (parent === step.id) {
      problems.push({ kind: 'self', stepId: step.id, text: `${step.id} can't run after itself.` });
    } else if (!known.has(parent)) {
      problems.push({
        kind: 'unknown_step',
        stepId: step.id,
        text: `${step.id} runs after ${parent}, which isn't a step in this workflow.`,
      });
    }
  }
  return problems;
}

function parentsOf(step: StepShape, known: ReadonlyMap<string, StepShape>): string[] {
  return [...new Set(step.dependsOn)].filter((parent) => parent !== step.id && known.has(parent));
}

function cycleFrom(start: string, known: ReadonlyMap<string, StepShape>): string[] | null {
  const path: string[] = [];
  const onPath = new Set<string>();
  const finished = new Set<string>();

  const visit = (id: string): string[] | null => {
    if (onPath.has(id)) return id === start ? [...path] : null;
    if (finished.has(id)) return null;
    const step = known.get(id);
    if (step === undefined) return null;
    onPath.add(id);
    path.push(id);
    for (const parent of parentsOf(step, known)) {
      const found = visit(parent);
      if (found !== null) return found;
    }
    path.pop();
    onPath.delete(id);
    finished.add(id);
    return null;
  };

  return visit(start);
}

function cycleProblems(known: ReadonlyMap<string, StepShape>): WorkflowProblem[] {
  const inCycle = new Set<string>();
  const problems: WorkflowProblem[] = [];
  for (const id of known.keys()) {
    if (inCycle.has(id)) continue;
    const cycle = cycleFrom(id, known);
    if (cycle === null) continue;
    for (const member of cycle) inCycle.add(member);
    problems.push({
      kind: 'cycle',
      stepId: id,
      text: `These steps wait on each other: ${[...cycle, id].join(' → ')}.`,
    });
  }
  return problems;
}

export const workflowProblems: WorkflowProblems = (steps, sparkIds) => {
  const known = firstById(steps);
  const sparks = steps
    .filter((step) => !sparkIds.has(step.sparkId))
    .map((step): WorkflowProblem => ({
      kind: 'unknown_spark',
      stepId: step.id,
      text: `${step.id} uses a Spark that no longer exists.`,
    }));
  return [
    ...duplicateProblems(steps),
    ...steps.flatMap((step) => dependencyProblems(step, known)),
    ...cycleProblems(known),
    ...sparks,
  ];
};

export const workflowStages: WorkflowStages = (steps) => {
  const known = firstById(steps);
  const stageOf = new Map<string, number>();
  let remaining = [...known.values()];
  while (remaining.length > 0) {
    const placed = remaining.filter((step) =>
      parentsOf(step, known).every((parent) => stageOf.has(parent)),
    );
    if (placed.length === 0) break;
    const stages = placed.map(
      (step) =>
        Math.max(-1, ...parentsOf(step, known).map((parent) => stageOf.get(parent) ?? -1)) + 1,
    );
    placed.forEach((step, index) => stageOf.set(step.id, stages[index] ?? 0));
    remaining = remaining.filter((step) => !stageOf.has(step.id));
  }
  const stages: string[][] = [];
  for (const [id, stage] of stageOf) {
    (stages[stage] ??= []).push(id);
  }
  if (remaining.length > 0) stages.push(remaining.map((step) => step.id));
  return stages;
};

export const workflowSummarySchema = z.object({
  id: crewSlugSchema,
  name: z.string(),
  stages: z.array(z.array(z.object({ stepId: crewSlugSchema, sparkId: z.uuid() }))),
  problems: z.number().int().nonnegative(),
});
export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;

export const workflowFileSchema = z.object({
  workflow: workflowSchema,
  hash: z.string(),
});
export type WorkflowFile = z.infer<typeof workflowFileSchema>;

export const saveWorkflowSchema = z.object({
  workflow: workflowSchema,
  baseHash: z.string().nullable(),
});
export type SaveWorkflow = z.infer<typeof saveWorkflowSchema>;
