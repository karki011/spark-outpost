import { CHECKPOINT_OPTION, type Approval } from '@spark-outpost/contracts';

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
  return { approvalId: last.id, variant: VARIANTS[last.decisionOptionId]! };
}
