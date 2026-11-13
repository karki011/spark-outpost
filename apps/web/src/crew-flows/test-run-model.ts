import {
  HELD_SEND_LABELS,
  type Approval,
  type ApprovalOption,
  type HeldSend,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowTestRun,
} from '@spark-outpost/contracts';
import { formatElapsed } from '../ui/elapsed.ts';
import { usageLine } from '../usage/format.ts';

const SETTLED = new Set(['succeeded', 'failed', 'skipped', 'cancelled']);

const RUN_WORDS: Record<WorkflowRun['status'], string> = {
  running: 'Running',
  succeeded: 'Finished',
  failed: 'Stopped: a step failed',
  cancelled: 'Stopped',
  outcome_unknown: 'Outcome unknown',
};

export function runWord(run: WorkflowRun): string {
  return RUN_WORDS[run.status];
}

export function elapsedMs(run: Pick<WorkflowRun, 'startedAt' | 'finishedAt'>, now: number) {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return Math.max(0, end - Date.parse(run.startedAt));
}

export function progressLine(test: WorkflowTestRun, now: number): string {
  const { steps } = test.run;
  const done = steps.filter((step) => SETTLED.has(step.state)).length;
  const { totalTokens, costUsd, costSource } = test.usage;
  const usage = usageLine(totalTokens > 0 ? totalTokens : null, costUsd, costSource);
  return [
    `${done} of ${steps.length} done`,
    formatElapsed(elapsedMs(test.run, now)),
    ...(usage ? [usage] : []),
  ].join(' · ');
}

export function copyLine(test: Pick<WorkflowTestRun, 'projectName'>): string {
  return test.projectName
    ? `Real agents on a throw-away copy of ${test.projectName}. Nothing is pushed, posted or saved.`
    : 'Real agents with no project. Nothing is pushed, posted or saved.';
}

export function stepTime(step: WorkflowRunStep, now: number): string | null {
  if (!step.startedAt) return null;
  const end = step.finishedAt ? Date.parse(step.finishedAt) : now;
  return formatElapsed(Math.max(0, end - Date.parse(step.startedAt)));
}

export function heldLine(held: HeldSend, labels: ReadonlyMap<string, string>) {
  const step = held.stepId ? (labels.get(held.stepId) ?? held.stepId) : null;
  return { kind: HELD_SEND_LABELS[held.kind], step, summary: held.summary };
}

export function firstShown(run: WorkflowRun, selected: string | null): string | null {
  if (selected && run.steps.some((step) => step.stepId === selected)) return selected;
  const working = run.steps.find((step) => step.state === 'running');
  const last = run.steps.findLast((step) => step.note !== null);
  return (working ?? last ?? run.steps[0])?.stepId ?? null;
}

export interface CardAnswer {
  optionId: string;
  label: string;
  allows: boolean;
}

export function cardAnswers(card: Approval): CardAnswer[] {
  const pick = (kind: ApprovalOption['kind'], label: string, allows: boolean): CardAnswer[] => {
    const option = card.options.find((entry) => entry.kind === kind && !entry.unavailableReason);
    return option ? [{ optionId: option.optionId, label, allows }] : [];
  };
  return [...pick('allow_once', 'Allow once', true), ...pick('reject_once', 'Deny', false)];
}

export function cardStep(card: Approval, run: WorkflowRun): string | null {
  return run.steps.find((step) => step.runId === card.runId)?.stepId ?? null;
}

export function polls(test: WorkflowTestRun | undefined): boolean {
  return !test || test.run.status === 'running';
}
