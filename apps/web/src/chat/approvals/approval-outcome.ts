import type { Approval, ApprovalOption } from '@spark-outpost/contracts';

interface Outcome {
  icon: 'ok' | 'no';
  label: string;
  detail: string;
}

export function isAllow(option: Pick<ApprovalOption, 'kind'>): boolean {
  return option.kind === 'allow_once' || option.kind === 'allow_always';
}

export function projectAllowOption(options: readonly ApprovalOption[]): ApprovalOption | undefined {
  return (
    options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always')
  );
}

export function shownOptions(approval: Approval): ApprovalOption[] {
  if (approval.reason === null) return approval.options;
  return approval.options.filter((option) => option.kind !== 'allow_always');
}

function chosenOption(approval: Approval): ApprovalOption | null {
  if (approval.decidedBy !== 'user' || approval.scope === 'project') return null;
  return approval.options.find((option) => option.optionId === approval.decisionOptionId) ?? null;
}

function planOutcome(approval: Approval, chose: string): Outcome {
  if (approval.status === 'allowed') {
    return { icon: 'ok', label: 'Plan approved.', detail: `${chose}Saved as the agreed plan.` };
  }
  if (approval.status === 'denied') {
    return {
      icon: 'no',
      label: 'Kept planning.',
      detail: `${chose}The agent can revise the plan.`,
    };
  }
  return outcome({ ...approval, payload: { ...approval.payload, plan: undefined } });
}

function stoppedOutcome(approval: Approval): Outcome | null {
  if (approval.status === 'cancelled') {
    return { icon: 'no', label: 'Cancelled.', detail: 'The run stopped before you answered.' };
  }
  if (approval.status === 'expired') {
    return {
      icon: 'no',
      label: 'Expired.',
      detail:
        approval.decidedBy === 'recovery'
          ? 'The run stopped unexpectedly, so the action never ran.'
          : 'Nobody answered within 30 minutes, so it was declined.',
    };
  }
  return null;
}

function deniedDetail(approval: Approval): string {
  return approval.kind === 'execute' ? "The command didn't run." : "The change wasn't made.";
}

function chosenDetail(approval: Approval): string {
  const forRun = approval.scope === 'run';
  if (approval.status === 'allowed') return forRun ? 'Allowed for this run.' : '';
  return `${deniedDetail(approval)}${forRun ? ' Rejected for the rest of this run.' : ''}`;
}

export function outcome(approval: Approval): Outcome {
  const chosen = chosenOption(approval);
  if (approval.payload.plan) return planOutcome(approval, chosen ? `Chose: ${chosen.name}. ` : '');
  const stopped = stoppedOutcome(approval);
  if (stopped) return stopped;
  if (chosen) {
    return {
      icon: approval.status === 'allowed' ? 'ok' : 'no',
      label: `Chose: ${chosen.name}.`,
      detail: chosenDetail(approval),
    };
  }
  switch (approval.status) {
    case 'allowed':
      if (approval.scope === 'run')
        return { icon: 'ok', label: 'Allowed for this run.', detail: '' };
      if (approval.scope === 'project') {
        return {
          icon: 'ok',
          label: 'Always allowed in this project.',
          detail: 'Added to the allowlist.',
        };
      }
      return { icon: 'ok', label: 'Allowed once.', detail: '' };
    case 'denied':
      return { icon: 'no', label: 'Denied.', detail: deniedDetail(approval) };
    default:
      return { icon: 'ok', label: '', detail: '' };
  }
}
