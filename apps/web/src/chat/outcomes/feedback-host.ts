import { CHECKPOINT_OPTION, type Approval, type PrWatch } from '@spark-outpost/contracts';

export type FeedbackVariant = 'kept' | 'reverted' | 'turn';

export interface KeepCardHost {
  approvalId: string;
  variant: Extract<FeedbackVariant, 'kept' | 'reverted'>;
}

const VARIANTS: Record<string, KeepCardHost['variant']> = {
  [CHECKPOINT_OPTION.keep]: 'kept',
  [CHECKPOINT_OPTION.revert]: 'reverted',
};

export function keepCardHost(
  approvals: readonly Pick<Approval, 'id' | 'decisionOptionId' | 'payload' | 'status'>[],
  revertedLater = false,
): KeepCardHost | null {
  const decided = approvals.filter(
    (approval) =>
      approval.payload.checkpoint?.kind === 'accept' &&
      approval.status !== 'pending' &&
      approval.decisionOptionId !== null &&
      VARIANTS[approval.decisionOptionId] !== undefined,
  );
  const last = decided.at(-1);
  if (!last?.decisionOptionId) return null;
  return {
    approvalId: last.id,
    variant: revertedLater ? 'reverted' : VARIANTS[last.decisionOptionId]!,
  };
}

export function isFeedbackTurn(
  watches: readonly Pick<PrWatch, 'opened'>[],
  turnRunIds: readonly string[],
): boolean {
  const first = watches
    .filter((watch) => watch.opened.runId !== null)
    .toSorted((a, b) => a.opened.at.localeCompare(b.opened.at))
    .at(0);
  return first?.opened.runId != null && turnRunIds.includes(first.opened.runId);
}
