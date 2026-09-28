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
  // The plan-only card (Approve plan / Revise the plan / Stop); the risky card is handled above.
  plan: {
    optionId: CHECKPOINT_OPTION.approvePlan,
    label: 'Approve plan',
    why: 'the plan reads fine',
  },
  retry: { optionId: CHECKPOINT_OPTION.retry, label: 'Retry', why: 'take Jev’s suggestion' },
  // Ask before edits always asks; Auto-edit asks only when checks fail or the Critic has concerns.
  accept: { optionId: CHECKPOINT_OPTION.keep, label: 'Keep', why: 'keep the finished work' },
  budget: { optionId: CHECKPOINT_OPTION.stop, label: 'Stop', why: 'never pass the cost cap' },
  merge_conflict: {
    optionId: CHECKPOINT_OPTION.reconcile,
    label: 'Ask a Builder to reconcile',
    why: 'let a Builder merge both',
  },
  stuck: {
    optionId: CHECKPOINT_OPTION.stopReport,
    label: 'Stop and report',
    why: 'an agent repeating itself will not get better',
  },
  verify: {
    optionId: CHECKPOINT_OPTION.finishUnverified,
    label: 'Finish as it is',
    why: 'the hidden tests judge it; do not pay for another tier',
  },
};

/** What the developer wanted from the turn, for the "Answer, or change the code?" card. */
export type UserIntent = 'answer' | 'change';

/**
 * The first "Fix these findings" offer: a Balanced developer lets one round fix the Critic's
 * correctness bugs, then keeps. "Fix again", or a card after a fix round was cut short by a
 * limit, gets Keep, so the bench never loops on fix rounds.
 */
export function firstFixOffer(approval: Approval): boolean {
  const option = approval.options.find((o) => o.optionId === CHECKPOINT_OPTION.fixFindings);
  if (!option || option.name !== 'Fix these findings') return false;
  return !/\b(?:Stopped fix round|Did not start fix round)\b/.test(approval.reason ?? '');
}

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

export function balancedChoice(approval: Approval, intent: UserIntent | null = null): UserChoice {
  if (approval.kind === 'edit' || approval.kind === 'execute' || approval.kind === 'other') {
    return toolChoice(approval);
  }
  const waitForAuto = Boolean(approval.autoContinueAt);
  if (approval.kind === 'clarify' && offered(approval, CHECKPOINT_OPTION.makeChange)) {
    const change = intent !== 'answer';
    return {
      optionId: change ? CHECKPOINT_OPTION.makeChange : CHECKPOINT_OPTION.justAnswer,
      scope: 'once',
      label: change ? 'Make the change' : 'Just answer; change nothing',
      waitForAuto: false,
      why: change ? 'the developer asked for a change' : 'the developer asked a question',
    };
  }
  if (approval.kind === 'plan' && offered(approval, CHECKPOINT_OPTION.makeChange)) {
    // "Start this risky change?" (destructive work or a migration, before the first Builder).
    return {
      optionId: CHECKPOINT_OPTION.makeChange,
      scope: 'once',
      label: 'Build it',
      waitForAuto,
      why: 'the developer asked for this risky change',
    };
  }
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
  if (approval.kind === 'accept' && firstFixOffer(approval)) {
    const option = approval.options.find((o) => o.optionId === CHECKPOINT_OPTION.fixFindings);
    return {
      optionId: CHECKPOINT_OPTION.fixFindings,
      scope: 'once',
      label: option?.name ?? 'Fix the findings',
      waitForAuto,
      why: 'the Critic found correctness bugs; let it fix them (≤3 rounds)',
    };
  }
  const known = CHECKPOINT_CHOICES[approval.kind];
  if (known && offered(approval, known.optionId)) {
    return { ...known, scope: 'once', waitForAuto };
  }
  const fallback = approval.options[0]?.optionId ?? CHECKPOINT_OPTION.stop;
  return { optionId: fallback, scope: 'once', label: '', waitForAuto, why: 'first option' };
}
