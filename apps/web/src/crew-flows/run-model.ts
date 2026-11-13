import type {
  Approval,
  WorkflowRun,
  WorkflowRunSource,
  WorkflowRunStatus,
  WorkflowRunStep,
  WorkflowStepState,
} from '@spark-outpost/contracts';
import { formatDuration } from '../audit/audit-model.ts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { formatCost } from '../usage/format.ts';
import { listed } from './workflow-model.ts';

export const STEP_WORDS: Record<WorkflowStepState, string> = {
  waiting: 'Waiting',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

export const RUN_WORDS: Record<WorkflowRunStatus, string> = {
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  outcome_unknown: 'Outcome unknown',
};

export const SOURCE_WORDS: Record<WorkflowRunSource, string> = {
  manual: 'Run button',
  mention: 'From a chat',
  schedule: 'Schedule',
  catch_up: 'Catch-up',
};

export const NEEDS_YOU = 'Needs you';

type Labels = ReadonlyMap<string, string>;
type StateOf = Pick<WorkflowRunStep, 'stepId' | 'dependsOn' | 'state'>;

const STARTED: ReadonlySet<WorkflowStepState> = new Set([
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export function edgeId(source: string, target: string): string {
  return `${source}>${target}`;
}

export function stepStates(steps: readonly StateOf[]): Record<string, WorkflowStepState> {
  return Object.fromEntries(steps.map((step) => [step.stepId, step.state]));
}

export function finishedEdges(steps: readonly StateOf[]): Set<string> {
  const states = stepStates(steps);
  const finished = new Set<string>();
  for (const step of steps) {
    if (!STARTED.has(step.state)) continue;
    for (const parent of step.dependsOn) {
      const state = states[parent];
      if (state === 'succeeded' || state === 'failed') finished.add(edgeId(parent, step.stepId));
    }
  }
  return finished;
}

export function passedTo(steps: readonly StateOf[], stepId: string): string[] {
  return steps.filter((step) => step.dependsOn.includes(stepId)).map((step) => step.stepId);
}

export function isLive(run: Pick<WorkflowRun, 'status'>): boolean {
  return run.status === 'running';
}

function span(startedAt: string | null, finishedAt: string | null, now: number): number | null {
  if (startedAt === null) return null;
  const end = finishedAt === null ? now : new Date(finishedAt).getTime();
  return Math.max(0, end - new Date(startedAt).getTime());
}

function clock(ms: number): string {
  return formatDuration(Math.floor(ms / 1000) * 1000).replace(/\.0s$/, 's');
}

export function runElapsed(
  run: Pick<WorkflowRun, 'startedAt' | 'finishedAt'>,
  now: number,
): string {
  return clock(span(run.startedAt, run.finishedAt, now) ?? 0);
}

export function stepElapsed(
  step: Pick<WorkflowRunStep, 'state' | 'startedAt' | 'finishedAt'>,
  now: number,
): string | null {
  if (step.state !== 'running' && step.finishedAt === null) return null;
  const ms = span(step.startedAt, step.finishedAt, now);
  return ms === null ? null : clock(ms);
}

export function costText(run: Pick<WorkflowRun, 'spend' | 'status'>): string | null {
  const { costUsd, costSource } = run.spend;
  if (costUsd !== null) return formatCost(costUsd, costSource === 'reported' ? null : 'estimated');
  return run.status === 'running' ? null : 'cost not reported';
}

export function statusParts(run: WorkflowRun, now: number): string[] {
  const done = run.steps.filter((step) => step.state === 'succeeded').length;
  const total = run.steps.length;
  return [
    `${done} of ${total} ${total === 1 ? 'step' : 'steps'} done`,
    runElapsed(run, now),
    `${formatTokens(run.spend.tokens)} tokens`,
    ...[costText(run)].filter((part) => part !== null),
  ];
}

function count(total: number, one: string, many: string): string {
  return `${total} ${total === 1 ? one : many}`;
}

function named(run: WorkflowRun, state: WorkflowStepState, labels: Labels): string[] {
  return run.steps
    .filter((step) => step.state === state)
    .map((step) => labels.get(step.stepId) ?? step.stepId);
}

function notStarted(run: WorkflowRun): string {
  const skipped = run.steps.filter((step) => step.state === 'skipped').length;
  if (skipped === 0) return '';
  return ` ${count(skipped, 'step', 'steps')} did not start.`;
}

export function outcomeText(run: WorkflowRun, labels: Labels): string | null {
  if (run.status === 'running') return null;
  if (run.status === 'succeeded') {
    const failed = named(run, 'failed', labels);
    if (failed.length === 0) return null;
    return `${listed(failed)} failed, and the workflow continued without ${failed.length === 1 ? 'it' : 'them'}.`;
  }
  if (run.status === 'failed') {
    if (run.stoppedBy === null) return `The run failed.${notStarted(run)}`;
    const stopper = labels.get(run.stoppedBy) ?? run.stoppedBy;
    return `Stopped by ${stopper}: it failed, and it is set to stop the workflow.${notStarted(run)}`;
  }
  if (run.status === 'cancelled') {
    const cancelled = named(run, 'cancelled', labels);
    const were =
      cancelled.length === 0
        ? ''
        : ` ${listed(cancelled)} ${cancelled.length === 1 ? 'was' : 'were'} cancelled.`;
    return `Stopped before it finished.${were}${notStarted(run)}`;
  }
  return `Spark stopped while this ran, so the outcome is unknown. Read the chat to see what the steps did before you run it again.${notStarted(run)}`;
}

export function waitingApproval(
  step: Pick<WorkflowRunStep, 'runId' | 'state'>,
  approvals: readonly Pick<Approval, 'id' | 'runId' | 'status'>[],
): string | null {
  if (step.state !== 'running' || step.runId === null) return null;
  const card = approvals.find(
    (approval) => approval.runId === step.runId && approval.status === 'pending',
  );
  return card?.id ?? null;
}

export function runWhen(run: Pick<WorkflowRun, 'startedAt'>): string {
  return new Date(run.startedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function latestRun(runs: readonly WorkflowRun[]): WorkflowRun | null {
  return runs.find((run) => run.kind === 'run') ?? null;
}
