import {
  roundOutcomeLine,
  type Approval,
  type Run,
  type RunStatus,
} from '@spark-outpost/contracts';
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

export function isAutomatedTurn(run: Run): boolean {
  return run.prFollowUp === true;
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

const DATA_TAG_LINE = /^[ \t]*<\/?pr_feedback>[ \t]*$/gm;
const DATA_TAG = /<(\/?)pr_feedback>/g;

export function sentForDisplay(text: string): string {
  return text.replace(DATA_TAG_LINE, '').replace(DATA_TAG, '`<$1pr_feedback>`');
}

export function opensOnItsOwn(status: RunStatus, waiting: boolean): boolean {
  return waiting || status === 'failed' || status === 'outcome_unknown';
}
