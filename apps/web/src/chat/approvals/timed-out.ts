import {
  APPROVAL_TIMED_OUT,
  APPROVAL_WAIT_MINUTES,
  type Approval,
  type ConversationDetail,
} from '@spark-outpost/contracts';
import { runIndex } from '../run-index.ts';

export const WAITED_LABEL = 'waited for you';

export function timedOut(error: string | null | undefined): boolean {
  return error === APPROVAL_TIMED_OUT;
}

export function askedBeforeTimeout(
  approvals: readonly Pick<Approval, 'status' | 'title' | 'createdAt'>[],
): string | null {
  const expired = approvals
    .filter((approval) => approval.status === 'expired')
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  return expired.at(-1)?.title ?? null;
}

export function timedOutText(asked: string | null): string {
  const waited = `Waited ${APPROVAL_WAIT_MINUTES} minutes for your answer`;
  const what = asked ? ` to “${asked}”` : '';
  return `${waited}${what}, then stopped. Nothing after that step ran.`;
}

export function retryMessage(asked: string | null): string {
  const what = asked ? `“${asked}”` : 'The last step';
  return `${what} timed out while waiting for my answer. Try that step again.`;
}

export function isLatestTurn(detail: Pick<ConversationDetail, 'runs'>, runId: string): boolean {
  const { latestTopLevelId, topLevel } = runIndex(detail.runs);
  return latestTopLevelId === runId || !topLevel.has(runId);
}
