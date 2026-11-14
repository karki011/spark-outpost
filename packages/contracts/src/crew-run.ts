import { z } from 'zod';
import { totalCostSourceSchema } from './audit.ts';
import { crewSlugSchema } from './crew-files.ts';
import type { WorkflowStep } from './crew-workflow.ts';

export const workflowStepStateSchema = z.enum([
  'waiting',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
]);
export type WorkflowStepState = z.infer<typeof workflowStepStateSchema>;

export const workflowRunStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'outcome_unknown',
]);
export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

export const workflowRunKindSchema = z.enum(['run', 'test']);
export type WorkflowRunKind = z.infer<typeof workflowRunKindSchema>;

export const workflowRunSourceSchema = z.enum(['manual', 'mention', 'schedule', 'catch_up']);
export type WorkflowRunSource = z.infer<typeof workflowRunSourceSchema>;

export type RunStep = Pick<WorkflowStep, 'id' | 'dependsOn' | 'join' | 'onFailure'>;
export type StepStates = Readonly<Record<string, WorkflowStepState>>;

export interface WorkflowPlan {
  start: string[];
  skip: string[];
  stoppedBy: string | null;
  finished: boolean;
}

export interface WorkflowPreview {
  rounds: string[][];
  states: Record<string, WorkflowStepState>;
  stoppedBy: string | null;
}

export type PlanWorkflow = (steps: readonly RunStep[], states: StepStates) => WorkflowPlan;
export type PreviewWorkflow = (
  steps: readonly RunStep[],
  failing: ReadonlySet<string>,
) => WorkflowPreview;
export type WorkflowOutcome = (
  steps: readonly RunStep[],
  states: StepStates,
) => Extract<WorkflowRunStatus, 'succeeded' | 'failed' | 'cancelled'>;

type ParentFate = 'pending' | 'passed' | 'dead';

function stateOf(states: StepStates, id: string): WorkflowStepState {
  return states[id] ?? 'waiting';
}

function stoppingStep(steps: readonly RunStep[], states: StepStates): string | null {
  const stopper = steps.find(
    (step) => stateOf(states, step.id) === 'failed' && step.onFailure === 'stop',
  );
  return stopper?.id ?? null;
}

function parentFate(parent: RunStep | undefined, states: StepStates): ParentFate {
  if (parent === undefined) return 'dead';
  const state = stateOf(states, parent.id);
  if (state === 'waiting' || state === 'running') return 'pending';
  if (state === 'succeeded') return 'passed';
  if (state === 'failed' && parent.onFailure === 'continue') return 'passed';
  return 'dead';
}

function readiness(step: RunStep, fates: readonly ParentFate[]): 'start' | 'skip' | 'wait' {
  if (fates.length === 0) return 'start';
  if (step.join === 'any') {
    if (fates.includes('passed')) return 'start';
    return fates.every((fate) => fate === 'dead') ? 'skip' : 'wait';
  }
  if (fates.includes('dead')) return 'skip';
  return fates.every((fate) => fate === 'passed') ? 'start' : 'wait';
}

export const planWorkflow: PlanWorkflow = (steps, states) => {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const waiting = steps.filter((step) => stateOf(states, step.id) === 'waiting');
  const running = steps.some((step) => stateOf(states, step.id) === 'running');
  const stoppedBy = stoppingStep(steps, states);
  const cancelled = steps.some((step) => stateOf(states, step.id) === 'cancelled');

  if (stoppedBy !== null || cancelled) {
    return {
      start: [],
      skip: waiting.map((step) => step.id),
      stoppedBy,
      finished: !running,
    };
  }

  const start: string[] = [];
  const skip: string[] = [];
  for (const step of waiting) {
    const fates = [...new Set(step.dependsOn)].map((parent) =>
      parentFate(byId.get(parent), states),
    );
    const ready = readiness(step, fates);
    if (ready === 'start') start.push(step.id);
    if (ready === 'skip') skip.push(step.id);
  }
  const stuck = start.length === 0 && skip.length === 0 && !running;
  return {
    start,
    skip: stuck ? waiting.map((step) => step.id) : skip,
    stoppedBy: null,
    finished: !running && start.length === 0 && (stuck || skip.length === waiting.length),
  };
};

export const previewWorkflow: PreviewWorkflow = (steps, failing) => {
  const states: Record<string, WorkflowStepState> = {};
  for (const step of steps) states[step.id] = 'waiting';
  const rounds: string[][] = [];

  for (let turn = 0; turn <= steps.length; turn += 1) {
    const plan = planWorkflow(steps, states);
    for (const id of plan.skip) states[id] = 'skipped';
    if (plan.start.length === 0) {
      if (plan.skip.length === 0) break;
      continue;
    }
    rounds.push(plan.start);
    for (const id of plan.start) states[id] = failing.has(id) ? 'failed' : 'succeeded';
  }

  return { rounds, states, stoppedBy: stoppingStep(steps, states) };
};

export const workflowOutcome: WorkflowOutcome = (steps, states) => {
  if (steps.some((step) => stateOf(states, step.id) === 'cancelled')) return 'cancelled';
  return stoppingStep(steps, states) === null ? 'succeeded' : 'failed';
};

export const workflowRunStepSchema = z.object({
  stepId: crewSlugSchema,
  sparkId: z.uuid(),
  dependsOn: z.array(crewSlugSchema),
  state: workflowStepStateSchema,
  runId: z.uuid().nullable(),
  note: z.string().nullable(),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type WorkflowRunStep = z.infer<typeof workflowRunStepSchema>;

export const workflowRunSpendSchema = z.object({
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  costSource: totalCostSourceSchema.nullable(),
});
export type WorkflowRunSpend = z.infer<typeof workflowRunSpendSchema>;

export const workflowRunSchema = z.object({
  id: z.uuid(),
  workflowId: crewSlugSchema,
  workflowName: z.string(),
  kind: workflowRunKindSchema,
  source: workflowRunSourceSchema,
  status: workflowRunStatusSchema,
  conversationId: z.uuid().nullable(),
  runId: z.uuid().nullable(),
  stoppedBy: crewSlugSchema.nullable(),
  steps: z.array(workflowRunStepSchema),
  spend: workflowRunSpendSchema,
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export const startWorkflowRunSchema = z.object({
  kind: workflowRunKindSchema.default('run'),
  projectId: z.uuid().nullable().default(null),
  conversationId: z.uuid().nullable().default(null),
  message: z.string().max(4000).default(''),
});
export type StartWorkflowRun = z.infer<typeof startWorkflowRunSchema>;
