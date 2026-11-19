import {
  TRY_IT_WORKFLOW_ID,
  planWorkflow,
  sparkWho,
  workflowOutcome,
  type Workflow,
  type WorkflowRunStatus,
  type WorkflowStep,
  type WorkflowStepState,
} from '@spark-outpost/contracts';
import {
  childFields,
  hasProject,
  publishOrchestration,
  runSparkChild,
  settingsFor,
  settingsRoute,
  type Handoff,
} from '../orchestration/spark-child.ts';
import { agentDefinitions } from '../agents/acp/agents.ts';
import type { TurnResult } from '../workflow/agent-turn.ts';
import { reviewStepPrompt, type ReviewPermission } from '../github-inbox/review/prompt.ts';
import {
  STEP_OUTCOME_UNKNOWN,
  finishWorkflowRun,
  settleStep,
  startStep,
  type TurnWorkflowRun,
} from './run-records.ts';
import { stepJobPrompt, type StepNote } from './step-prompt.ts';
import { runsInChat, stepSparks, type StepSpark } from './step-sparks.ts';

export const SPARK_GONE = 'This step’s Spark no longer exists.';
export const STEP_CRASHED = 'The step stopped with an unexpected error.';
export const REVIEW_GONE = 'This review no longer exists, so the step did not run.';

type Settled = Exclude<WorkflowStepState, 'waiting' | 'running'>;

interface StepEnd {
  id: string;
  state: Settled | 'lease_lost';
  note: string | null;
}

export interface WorkflowEnd {
  status: Exclude<WorkflowRunStatus, 'running'>;
  stoppedBy: string | null;
  steps: StepNote[];
}

export interface ReviewOptions {
  material: string;
  permission: ReviewPermission;
}

export interface RunOptions {
  findings?: boolean;
  review?: ReviewOptions | null;
}

interface Running {
  h: Handoff;
  turn: TurnWorkflowRun;
  options: RunOptions;
  sparks: ReadonlyMap<string, StepSpark>;
  inChat: boolean;
  states: Record<string, WorkflowStepState>;
  notes: Map<string, string | null>;
}

function endOf(id: string, result: TurnResult): StepEnd {
  if (result.outcome === 'lease_lost') return { id, state: 'lease_lost', note: null };
  if (result.outcome === 'succeeded') return { id, state: 'succeeded', note: result.text };
  if (result.outcome === 'cancelled') return { id, state: 'cancelled', note: null };
  return { id, state: 'failed', note: result.error ?? (result.text || null) };
}

function whoOf(run: Running, step: WorkflowStep): string {
  const spark = run.sparks.get(step.sparkId);
  return spark ? sparkWho(spark) : 'a Spark that no longer exists';
}

function noteOf(run: Running, step: WorkflowStep): StepNote {
  return {
    stepId: step.id,
    who: whoOf(run, step),
    state: run.states[step.id] ?? 'waiting',
    note: run.notes.get(step.id) ?? null,
  };
}

function passedOn(run: Running, step: WorkflowStep, workflow: Workflow): StepNote[] {
  const parents = new Set(step.dependsOn);
  return workflow.steps
    .filter((parent) => parents.has(parent.id))
    .map((parent) => noteOf(run, parent))
    .filter((note) => note.state === 'succeeded' || note.state === 'failed');
}

export function stepEditsOffered(provider: string): boolean {
  const definitions: Readonly<Record<string, { cli?: string } | undefined>> = agentDefinitions;
  return definitions[provider]?.cli === 'claude';
}

function promptFor(run: Running, step: WorkflowStep, spark: StepSpark, editing: boolean): string {
  const { h, turn } = run;
  const review = run.options.review;
  if (turn.run.kind === 'review' && review) {
    return reviewStepPrompt({
      spark,
      workflow:
        turn.workflow.id === TRY_IT_WORKFLOW_ID
          ? null
          : { name: turn.workflow.name, stepId: step.id, stepPrompt: step.prompt },
      material: review.material,
      permission: review.permission,
      earlier: passedOn(run, step, turn.workflow),
    });
  }
  const edits = turn.edits && hasProject(h.input) && turn.run.kind !== 'test';
  return stepJobPrompt({
    spark,
    workflowName: turn.workflow.name,
    stepId: step.id,
    stepPrompt: step.prompt,
    message: turn.message,
    hasProject: hasProject(h.input),
    earlier: passedOn(run, step, turn.workflow),
    testRun: turn.run.kind === 'test',
    edits: editing ? 'yes' : edits ? 'unsupported' : 'no',
    findings: run.options.findings === true,
  });
}

async function launch(run: Running, step: WorkflowStep, index: number): Promise<StepEnd> {
  const { h, turn } = run;
  const spark = run.sparks.get(step.sparkId);
  if (!spark) return { id: step.id, state: 'failed', note: SPARK_GONE };
  if (turn.run.kind === 'review' && !run.options.review) {
    return { id: step.id, state: 'failed', note: REVIEW_GONE };
  }
  const reviewRun = turn.run.kind === 'review';
  const settings = settingsFor(h, spark, { inChat: run.inChat, appliesOwnMode: !reviewRun });
  const testRun = turn.run.kind === 'test';
  const edits = turn.edits && hasProject(h.input) && !testRun;
  const editing = edits && stepEditsOffered(settings.provider);
  try {
    const result = await runSparkChild(
      h,
      {
        role: 'spark',
        stepIndex: index,
        attempt: 1,
        agentLabel: sparkWho(spark),
        ...childFields(settings),
        mode: hasProject(h.input) ? 'ask' : 'chat',
        prompt: promptFor(run, step, spark, editing),
        route: {
          name: spark.name,
          routedBy: 'fixed',
          spark: {
            id: spark.id,
            role: spark.role,
            only: !turn.continues,
            step: step.id,
            ...(testRun ? { test: true } : {}),
            ...(editing ? { edits: true } : {}),
            ...(reviewRun ? { review: true } : {}),
            ...settingsRoute(settings),
          },
        },
      },
      (runId) => startStep(h.deps.db, turn.run.id, step.id, runId),
    );
    return endOf(step.id, result);
  } catch (error) {
    console.error(`Workflow step ${step.id} failed unexpectedly`, error);
    return { id: step.id, state: 'failed', note: STEP_CRASHED };
  }
}

async function settle(run: Running, id: string, state: Settled, note: string | null) {
  run.states[id] = state;
  run.notes.set(id, note);
  await settleStep(run.h.deps.db, run.turn.run.id, id, state, note);
}

function startingStates(turn: TurnWorkflowRun): Running['states'] {
  return Object.fromEntries(turn.run.steps.map((step) => [step.stepId, step.state]));
}

export async function runWorkflow(
  h: Handoff,
  turn: TurnWorkflowRun,
  options: RunOptions = {},
): Promise<WorkflowEnd | 'lease_lost'> {
  const { steps } = turn.workflow;
  const run: Running = {
    h,
    turn,
    options,
    sparks: await stepSparks(
      h.deps.db,
      h.input.workspaceId,
      steps.map((step) => step.sparkId),
    ),
    inChat: await runsInChat(h.deps.db, turn),
    states: startingStates(turn),
    notes: new Map(turn.run.steps.map((step) => [step.stepId, step.note])),
  };
  for (const step of turn.run.steps) {
    if (step.state === 'running') await settle(run, step.stepId, 'failed', STEP_OUTCOME_UNKNOWN);
  }
  const running = new Map<string, Promise<StepEnd>>();
  let leaseLost = false;

  for (;;) {
    const stopping = leaseLost || h.control.signal.aborted;
    const waiting = steps.filter((step) => run.states[step.id] === 'waiting');
    const plan = stopping
      ? { start: [], skip: leaseLost ? [] : waiting.map((step) => step.id) }
      : planWorkflow(steps, run.states);
    for (const id of plan.skip) await settle(run, id, 'skipped', null);
    for (const id of plan.start) {
      const index = steps.findIndex((step) => step.id === id);
      run.states[id] = 'running';
      running.set(id, launch(run, steps[index]!, index));
    }
    if (running.size === 0) break;
    const ended = await Promise.race(running.values());
    running.delete(ended.id);
    if (ended.state === 'lease_lost') {
      leaseLost = true;
      continue;
    }
    await settle(run, ended.id, ended.state, ended.note);
    await publishOrchestration(h).catch(() => undefined);
  }

  if (leaseLost || h.control.reason() === 'lease_lost') return 'lease_lost';
  const status = h.control.signal.aborted ? 'cancelled' : workflowOutcome(steps, run.states);
  const stoppedBy = status === 'failed' ? planWorkflow(steps, run.states).stoppedBy : null;
  await finishWorkflowRun(h.deps.db, turn.run.id, status, stoppedBy);
  return { status, stoppedBy, steps: steps.map((step) => noteOf(run, step)) };
}
