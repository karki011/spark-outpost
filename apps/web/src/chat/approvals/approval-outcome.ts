import {
  sparkActionLabels,
  sparkRetryAllowed,
  type Approval,
  type ApprovalOption,
} from '@spark-outpost/contracts';

interface Outcome {
  icon: 'ok' | 'no' | 'busy';
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
  if (approval.status === 'allowed' && approval.scope === 'chat') return 'Allowed for this chat.';
  if (approval.status === 'allowed') return forRun ? 'Allowed for this run.' : '';
  return `${deniedDetail(approval)}${forRun ? ' Rejected for the rest of this run.' : ''}`;
}

function sparkOutcome(approval: Approval): Outcome | null {
  const result = approval.payload.sparkResult;
  if (!result || approval.status !== 'allowed') return null;
  const byMode = approval.decidedBy === 'level';
  const action = approval.payload.sparkAction;
  if (result.state === 'failed') {
    return { icon: 'no', label: 'It failed.', detail: result.message ?? '' };
  }
  if (result.state === 'unknown') {
    return {
      icon: 'no',
      label: 'Outcome unknown.',
      detail: `${result.message ?? ''} ${
        action && sparkRetryAllowed(action, result)
          ? 'Trying again is safe.'
          : 'Check before asking the agent again, so it is not done twice.'
      }`.trim(),
    };
  }
  if (result.state === 'done') {
    return {
      icon: 'ok',
      label: result.message ?? 'Done.',
      detail: byMode ? ' Done without a card: the agent’s mode allows it.' : '',
    };
  }
  const doing = action ? sparkActionLabels[action.action].doing : 'Spark is doing it…';
  return { icon: 'busy', label: byMode ? doing : `Confirmed. ${doing}`, detail: '' };
}

const RETIRED_OPEN_PR: Outcome = {
  icon: 'no',
  label: 'No longer offered.',
  detail: 'Agents open pull requests themselves now. Ask the agent, or use Ship.',
};

export function outcome(approval: Approval): Outcome {
  if (approval.status === 'pending' && approval.payload.sparkAction?.action === 'open_pr') {
    return RETIRED_OPEN_PR;
  }
  const spark = sparkOutcome(approval);
  if (spark) return spark;
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
      if (approval.scope === 'chat') {
        return { icon: 'ok', label: 'Allowed for this chat.', detail: '' };
      }
      if (approval.scope === 'project') {
        return {
          icon: 'ok',
          label: 'Always allowed in this project.',
          detail: 'Added to the allowlist.',
        };
      }
      return { icon: 'ok', label: 'Allowed once.', detail: '' };
    case 'denied':
      if (approval.decidedBy === 'policy') {
        return { icon: 'no', label: "Spark's policy blocked it.", detail: deniedDetail(approval) };
      }
      return { icon: 'no', label: 'Denied.', detail: deniedDetail(approval) };
    default:
      return { icon: 'ok', label: '', detail: '' };
  }
}
