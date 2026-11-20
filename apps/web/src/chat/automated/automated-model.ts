import type { Approval, Run, RunStatus } from '@spark-outpost/contracts';

export function isAutomatedTurn(run: Run): boolean {
  return run.prFollowUp === true;
}

export function waitsOnYou(approvals: readonly Approval[], runIds: readonly string[]): boolean {
  return approvals.some(
    (approval) => approval.status === 'pending' && runIds.includes(approval.runId),
  );
}

const DATA_TAG_LINE = /^[ \t]*<\/?pr_feedback>[ \t]*$/gm;
const DATA_TAG = /<(\/?)pr_feedback>/g;

export function sentForDisplay(text: string): string {
  return text.replace(DATA_TAG_LINE, '').replace(DATA_TAG, '`<$1pr_feedback>`');
}

export function opensOnItsOwn(status: RunStatus, waiting: boolean): boolean {
  return waiting || status === 'failed' || status === 'outcome_unknown';
}
