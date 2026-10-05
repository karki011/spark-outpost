import {
  APPROVAL_DECIDED,
  APPROVAL_REQUESTED,
  approvalDecidedValueSchema,
  approvalSchema,
  type Approval,
  type ApprovalDecidedValue,
} from '@spark-outpost/contracts';

export interface ApprovalEvent {
  name: string;
  value: unknown;
}

export function mergeDecision(approvals: readonly Approval[], decision: ApprovalDecidedValue) {
  return approvals.map((approval) =>
    approval.id === decision.id ? { ...approval, ...decision } : approval,
  );
}

export function applyApprovalEvent(
  approvals: readonly Approval[],
  event: ApprovalEvent,
): readonly Approval[] {
  if (event.name === APPROVAL_REQUESTED) {
    const parsed = approvalSchema.safeParse(event.value);
    if (!parsed.success || approvals.some((approval) => approval.id === parsed.data.id)) {
      return approvals;
    }
    return [...approvals, parsed.data];
  }
  if (event.name === APPROVAL_DECIDED) {
    const parsed = approvalDecidedValueSchema.safeParse(event.value);
    return parsed.success ? mergeDecision(approvals, parsed.data) : approvals;
  }
  return approvals;
}

export function decidedFirst<T extends Pick<Approval, 'status'>>(
  approvals: readonly T[],
): { decided: T[]; pending: T[] } {
  return {
    decided: approvals.filter((approval) => approval.status !== 'pending'),
    pending: approvals.filter((approval) => approval.status === 'pending'),
  };
}

export function hasPending(approvals: readonly Approval[]): boolean {
  return approvals.some((approval) => approval.status === 'pending');
}
