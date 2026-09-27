import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  type Approval,
  type ApprovalScope,
} from '../../packages/contracts/src/index.ts';

export interface UserChoice {
  optionId: string;
  scope: ApprovalScope;
  label: string;
  waitForAuto: boolean;
  why: string;
}

const RISKY_COMMAND =
  /\bgit\s+push\b|\bsudo\b|\bcurl\b|\bwget\b|\brm\s+-[a-z]*r[a-z]*f?\s+(?:\/|~)|\bnpm\s+publish\b/;

const CHECKPOINT_CHOICES: Record<string, { optionId: string; label: string; why: string }> = {
  plan: { optionId: CHECKPOINT_OPTION.approvePlan, label: 'Approve', why: 'the plan reads fine' },
  retry: { optionId: CHECKPOINT_OPTION.retry, label: 'Retry', why: 'take Jev’s suggestion' },
  accept: { optionId: CHECKPOINT_OPTION.keep, label: 'Keep', why: 'keep the finished work' },
  budget: { optionId: CHECKPOINT_OPTION.stop, label: 'Stop', why: 'never pass the cost cap' },
  merge_conflict: {
    optionId: CHECKPOINT_OPTION.reconcile,
    label: 'Ask a Builder to reconcile',
    why: 'let a Builder merge both',
  },
};

function offered(approval: Approval, optionId: string): boolean {
  return approval.options.some((option) => option.optionId === optionId);
}

function toolChoice(approval: Approval): UserChoice {
  const allow = approval.options.find((option) => option.kind === 'allow_once');
  const deny = approval.options.find((option) => option.kind === 'reject_once');
  const command = approval.payload.command ?? '';
  if (approval.kind === 'execute' && RISKY_COMMAND.test(command) && deny) {
    return {
      optionId: deny.optionId,
      scope: 'once',
      label: 'Deny',
      waitForAuto: false,
      why: 'a risky command',
    };
  }
  const optionId = allow?.optionId ?? approval.options[0]?.optionId ?? 'allow';
  if (approval.reason !== null) {
    return { optionId, scope: 'once', label: 'Allow', waitForAuto: false, why: approval.reason };
  }
  return {
    optionId,
    scope: 'run',
    label: 'Allow for this run',
    waitForAuto: false,
    why: approval.kind === 'edit' ? 'edits inside the scratch repo' : 'a routine command',
  };
}

export function balancedChoice(approval: Approval): UserChoice {
  if (approval.kind === 'edit' || approval.kind === 'execute' || approval.kind === 'other') {
    return toolChoice(approval);
  }
  const waitForAuto = Boolean(approval.autoContinueAt);
  if (approval.kind === 'clarify') {
    const first = approval.payload.checkpoint?.choices[0];
    if (first && offered(approval, clarifyOptionId(0))) {
      return {
        optionId: clarifyOptionId(0),
        scope: 'once',
        label: first,
        waitForAuto,
        why: 'Jev’s first suggestion',
      };
    }
    return {
      optionId: CHECKPOINT_OPTION.clarifyRules,
      scope: 'once',
      label: 'Let the rules decide',
      waitForAuto,
      why: 'no suggestion offered',
    };
  }
  const known = CHECKPOINT_CHOICES[approval.kind];
  if (known && offered(approval, known.optionId)) {
    return { ...known, scope: 'once', waitForAuto };
  }
  const fallback = approval.options[0]?.optionId ?? CHECKPOINT_OPTION.stop;
  return { optionId: fallback, scope: 'once', label: '', waitForAuto, why: 'first option' };
}
