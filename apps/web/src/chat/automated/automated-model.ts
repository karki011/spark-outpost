import {
  roundOutcomeLine,
  type Approval,
  type Run,
  type RunStatus,
  type WorkflowRun,
  type WorkflowRunStatus,
} from '@spark-outpost/contracts';
import { SOURCE_WORDS } from '../../crew-flows/run-model.ts';
import { roundSummary, type TurnOutcome } from '../pull-request/round-model.ts';

const STATUS_WORDS: Record<RunStatus, string> = {
  queued: 'Waiting to start',
  running: 'Working',
  awaiting_approval: 'Needs you',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
  outcome_unknown: 'Outcome unknown',
};

export function isAutomatedTurn(run: Run, previous: Run | null): boolean {
  if (run.prFollowUp === true) return true;
  return run.workflowStarted === true && previous !== null;
}

export function waitsOnYou(approvals: readonly Approval[], runIds: readonly string[]): boolean {
  return approvals.some(
    (approval) => approval.status === 'pending' && runIds.includes(approval.runId),
  );
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function roundHeadline(
  outcome: TurnOutcome | null,
  message: string,
  status: RunStatus,
): string {
  if (!outcome) return `${roundSummary(message)} · ${STATUS_WORDS[status]}`;
  const did = sentenceCase(roundOutcomeLine(outcome.outcome).replace(/^Follow-up /, ''));
  return `PR #${outcome.watch.number} · round ${outcome.outcome.round} · ${did}`;
}

export function workflowHeadline(run: WorkflowRun): string {
  const done = run.steps.filter((step) => step.state === 'succeeded').length;
  return `${SOURCE_WORDS[run.source]} · ${done} of ${run.steps.length} steps done`;
}

const DATA_TAG_LINE = /^[ \t]*<\/?pr_feedback>[ \t]*$/gm;
const DATA_TAG = /<(\/?)pr_feedback>/g;

export function sentForDisplay(text: string): string {
  return text.replace(DATA_TAG_LINE, '').replace(DATA_TAG, '`<$1pr_feedback>`');
}

const MENTION = /^@([\w.-]+)/;

export function workflowLabel(run: WorkflowRun | null, message: string): string {
  return run?.workflowName ?? MENTION.exec(message.trim())?.[1] ?? '';
}

type AnyRunStatus = RunStatus | WorkflowRunStatus;

export function opensOnItsOwn(statuses: readonly AnyRunStatus[], waiting: boolean): boolean {
  return waiting || statuses.some((status) => status === 'failed' || status === 'outcome_unknown');
}
