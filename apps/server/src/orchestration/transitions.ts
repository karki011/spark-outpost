import {
  CHECKPOINT_OPTION,
  MAX_REPAIR_RETRIES,
  type AgentRole,
  type BudgetLimit,
  type CheckpointKind,
  type Depth,
  type InvolvementLevel,
  type OrchestrationPhase,
  type ReviewVerdict,
  type Risk,
} from '@spark-outpost/contracts';
import { MAX_VERDICTS, PLAN_CONTINUES } from '../advisor/policy.ts';
import type { Verdict } from '../advisor/verify-questions.ts';
import {
  asksToKeep,
  asksForLoop,
  keepReason,
  keepsByItself,
  shipsByItself,
  type KeepFacts,
} from './checkpoint-policy.ts';
import { criticFixFollowUp } from './context.ts';
import { reviewExisting, writePlan } from './read-only-flow.ts';
import {
  afterReview,
  canFixAgain,
  checksFailedAfterFix,
  fixRefused,
  IDLE_REVIEW,
  lastAction,
  startFix,
  type ReviewLoop,
} from './review-loop.ts';

export type SpawnReason =
  'first' | 'retry' | 'fix' | 'continue' | 'resume' | 'unstick' | 'escalate' | 'recheck';

export interface Spawn {
  role: AgentRole;
  reason: SpawnReason;
  escalate: boolean;
  note: string | null;
  followUp?: string;
}

export type FlowAction =
  | {
      type: 'ask';
      kind: CheckpointKind;
      reason: string;
      interpret?: boolean;
      answerOrBuild?: boolean;
    }
  | ({ type: 'spawn' } & Spawn)
  | { type: 'plan'; note: string | null }
  | { type: 'verify' }
  | { type: 'wrap_up' }
  | { type: 'keep' }
  | { type: 'ship' }
  | { type: 'revert' }
  | {
      type: 'finish';
      status: 'succeeded' | 'failed' | 'cancelled';
      reason: string | null;
      incomplete?: string;
    };

export type AgentOutcome = 'succeeded' | 'failed' | 'cancelled';

export type StartMode = 'answer' | 'build' | 'interpret' | 'choose' | 'plan' | 'review';

export type ReadOnlyWork = 'plan' | 'review';

export type FlowEvent =
  | { type: 'start'; start: StartMode }
  | { type: 'clarified'; answer: boolean | null }
  | {
      type: 'agent_done';
      role: AgentRole;
      outcome: AgentOutcome;
      error?: string | null;
      open?: readonly string[];
      large?: boolean;
      green?: boolean;
      verdict?: ReviewVerdict;
      fixable?: readonly string[];
      checksFailing?: boolean;
    }
  | { type: 'verified'; accepted: Verdict | null; reasons: readonly string[] }
  | { type: 'looped'; summary: string; open?: readonly string[] }
  | { type: 'answered'; kind: CheckpointKind; optionId: string; note: string | null }
  | { type: 'wrapped'; filesChanged: number; checksFailing?: boolean }
  | { type: 'kept' }
  | { type: 'shipped' }
  | { type: 'ship_held'; reason: string }
  | { type: 'reverted' }
  | { type: 'budget_exceeded'; limit: BudgetLimit; unstarted?: boolean }
  | { type: 'stopped' };

export interface FlowState {
  depth: Depth;
  risk: Risk;
  level: InvolvementLevel;
  phase: OrchestrationPhase;
  reviewWanted: boolean;
  retries: number;
  continues: number;
  reviewed: boolean;
  verdict: ReviewVerdict | null;
  last: Spawn | null;
  waitingFor: CheckpointKind | null;
  exceeded: BudgetLimit | null;
  resumeLast: boolean;
  open: string[];
  loop: string | null;
  verifier: boolean;
  verdicts: number;
  escalated: boolean;
  large: boolean;
  review: ReviewLoop;
  shipping?: boolean;
  readOnly?: ReadOnlyWork;
  /** Why this change needs your go-ahead before the first Builder starts; null once given. */
  confirmFirst: string | null;
}

export interface FlowResult {
  state: FlowState;
  action: FlowAction;
}

export function initialFlow(
  risk: Risk,
  level: InvolvementLevel,
  reviewWanted = false,
  verifier = false,
  confirmFirst: string | null = null,
): FlowState {
  return {
    depth: 'execute',
    risk,
    level,
    phase: 'intake',
    reviewWanted: reviewWanted || risk === 'destructive',
    retries: 0,
    continues: 0,
    reviewed: false,
    verdict: null,
    last: null,
    waitingFor: null,
    exceeded: null,
    resumeLast: false,
    open: [],
    loop: null,
    verifier,
    verdicts: 0,
    escalated: false,
    large: false,
    review: IDLE_REVIEW,
    confirmFirst,
  };
}

const PHASE_FOR_ROLE: Record<AgentRole, OrchestrationPhase> = {
  scout: 'scouting',
  architect: 'planning',
  builder: 'building',
  critic: 'reviewing',
};

function spawn(state: FlowState, next: Omit<Spawn, 'note'> & { note?: string | null }): FlowResult {
  const full: Spawn = { ...next, note: next.note ?? null };
  return {
    state: { ...state, phase: PHASE_FOR_ROLE[full.role], last: full, waitingFor: null },
    action: { type: 'spawn', ...full },
  };
}

function ask(
  state: FlowState,
  kind: CheckpointKind,
  reason: string,
  extra: Partial<Extract<FlowAction, { type: 'ask' }>> = {},
): FlowResult {
  return {
    state: { ...state, phase: 'waiting', waitingFor: kind },
    action: { type: 'ask', kind, reason, ...extra },
  };
}

function listText(items: readonly string[]): string {
  const shown = items.slice(0, 5).map((item) => `"${item}"`);
  const more = items.length > 5 ? ` and ${items.length - 5} more` : '';
  return `${shown.join(', ')}${more}`;
}

export function incompleteLine(open: readonly string[]): string | null {
  if (open.length === 0) return null;
  const verb = open.length === 1 ? 'is' : 'are';
  const noun = open.length === 1 ? 'plan item' : 'plan items';
  return `Incomplete: ${open.length} ${noun} ${verb} still open: ${listText(open)}. Ask to continue and the Builder picks up from there.`;
}

export function finish(
  state: FlowState,
  status: 'succeeded' | 'failed' | 'cancelled',
  reason: string | null = null,
): FlowResult {
  const incomplete = status === 'cancelled' ? null : incompleteLine(state.open);
  return {
    state: { ...state, phase: 'finished', waitingFor: null },
    action: { type: 'finish', status, reason, ...(incomplete ? { incomplete } : {}) },
  };
}

function ship(state: FlowState): FlowResult {
  return { state: { ...state, waitingFor: null, shipping: true }, action: { type: 'ship' } };
}

function wrapUp(state: FlowState): FlowResult {
  return { state: { ...state, waitingFor: null }, action: { type: 'wrap_up' } };
}

export function continueFollowUp(open: readonly string[]): string {
  return `You stopped before finishing: ${listText(open)} ${open.length === 1 ? 'is' : 'are'} still open in your plan. Continue with ${open.length === 1 ? 'it' : 'them'} now, then reply with what you changed.`;
}

export const UNSTICK_NOTE =
  'The harness stopped your last turn because you repeated the same action several times without progress. Take a different approach, or say what is blocking you.';

function build(state: FlowState): FlowResult {
  if (state.confirmFirst) return ask(state, 'plan', state.confirmFirst);
  return spawn(
    { ...state, depth: 'execute' },
    { role: 'builder', reason: 'first', escalate: false },
  );
}

function answer(state: FlowState): FlowResult {
  return spawn({ ...state, depth: 'direct' }, { role: 'scout', reason: 'first', escalate: false });
}

function retry(state: FlowState, note: string | null = null): FlowResult {
  return spawn(
    { ...state, retries: state.retries + 1 },
    { role: 'builder', reason: 'retry', escalate: true, note },
  );
}

function afterBuilder(state: FlowState, large: boolean): FlowResult {
  if (state.review.fixing) {
    return spawn(state, { role: 'critic', reason: 'recheck', escalate: false });
  }
  if ((state.reviewWanted || large) && !state.reviewed) {
    return spawn(
      { ...state, reviewed: true },
      { role: 'critic', reason: 'first', escalate: false },
    );
  }
  return wrapUp(state);
}

function stopReport(state: FlowState, reason: string): FlowResult {
  return finish(state, 'failed', reason);
}

function builderDone(
  state: FlowState,
  event: Extract<FlowEvent, { type: 'agent_done' }>,
): FlowResult {
  const next = { ...state, open: [...(event.open ?? state.open)] };
  if (event.outcome === 'failed') {
    if (next.retries < MAX_REPAIR_RETRIES) return retry(next);
    return ask(next, 'retry', `Stopped after ${MAX_REPAIR_RETRIES} retries.`);
  }
  if (next.open.length > 0 && next.continues < PLAN_CONTINUES) {
    return spawn(
      { ...next, continues: next.continues + 1 },
      {
        role: 'builder',
        reason: 'continue',
        escalate: false,
        followUp: continueFollowUp(next.open),
      },
    );
  }
  if (next.review.fixing && event.checksFailing) {
    return wrapUp({ ...next, review: checksFailedAfterFix(next.review) });
  }
  const large = event.large ?? false;
  if (next.verifier && event.green && next.verdicts < MAX_VERDICTS) {
    return { state: { ...next, large, waitingFor: null }, action: { type: 'verify' } };
  }
  return afterBuilder(next, large);
}

export type CascadeAction = 'escalate' | 'ask' | 'finish';

export function cascadeAction(accepted: Verdict | null, escalated: boolean): CascadeAction {
  if (escalated) return 'finish';
  if (accepted === 'unsupported') return 'escalate';
  if (accepted === 'declined') return 'ask';
  return 'finish';
}

export function escalateFollowUp(reasons: readonly string[]): string {
  const missing =
    reasons.length > 0
      ? ` These requirements look unmet: ${listText(reasons)}.`
      : ' A stated case, value or edge case looks missing or different from what was asked.';
  return `An independent check of your change against the request found that it does not yet do everything asked.${missing} Re-read the request, finish what is missing without undoing what works, then reply with what you changed.`;
}

export const ESCALATED_NOTE =
  'The Builder ran again one tier up after Jev could not confirm the first attempt did everything asked.';

export const DECLINED_REASON =
  'Jev could not confirm the change does what you asked: the diff does not settle it, or the work looks refused or left unfinished on purpose.';

function escalateOnce(state: FlowState, followUp: string): FlowResult {
  return spawn(
    { ...state, escalated: true },
    { role: 'builder', reason: 'escalate', escalate: true, followUp },
  );
}

function refusedFix(state: FlowState, unstarted: boolean): boolean {
  return (
    unstarted &&
    state.review.fixing &&
    state.last?.role === 'builder' &&
    state.last.reason === 'fix'
  );
}

function fixFindings(state: FlowState): FlowResult {
  return spawn(
    { ...state, review: startFix(state.review) },
    {
      role: 'builder',
      reason: 'fix',
      escalate: false,
      followUp: criticFixFollowUp(state.review.fixable),
    },
  );
}

function verified(state: FlowState, event: Extract<FlowEvent, { type: 'verified' }>): FlowResult {
  const next = { ...state, verdicts: state.verdicts + 1 };
  const action = cascadeAction(event.accepted, state.escalated);
  if (action === 'escalate') return escalateOnce(next, escalateFollowUp(event.reasons));
  if (action === 'ask') return ask(next, 'verify', DECLINED_REASON);
  return afterBuilder(next, state.large);
}

function agentDone(
  state: FlowState,
  event: Extract<FlowEvent, { type: 'agent_done' }>,
): FlowResult {
  if (event.outcome === 'cancelled') return finish(state, 'cancelled', 'Stopped.');
  if (event.role === 'scout') {
    return event.outcome === 'succeeded'
      ? finish(state, 'succeeded')
      : finish(state, 'failed', event.error ?? 'The agent hit a problem.');
  }
  if (event.role === 'critic' && state.readOnly === 'review') {
    if (event.outcome !== 'succeeded') {
      return finish(state, 'failed', event.error ?? 'The review hit a problem.');
    }
    return finish({ ...state, verdict: event.verdict ?? 'unclear' }, 'succeeded');
  }
  if (event.role === 'critic') {
    const verdict = event.outcome === 'succeeded' ? (event.verdict ?? 'unclear') : 'unclear';
    const review = afterReview(state.review, verdict, event.fixable ?? [], state.level);
    const next = { ...state, verdict, review };
    return lastAction(review) === 'fix' ? fixFindings(next) : wrapUp(next);
  }
  return builderDone(state, event);
}

function looped(state: FlowState, event: Extract<FlowEvent, { type: 'looped' }>): FlowResult {
  const next = { ...state, loop: event.summary, open: [...(event.open ?? state.open)] };
  if (asksForLoop(state.level) && state.retries < MAX_REPAIR_RETRIES) {
    return ask(next, 'stuck', event.summary);
  }
  return stopReport(next, `Stopped: ${event.summary}.`);
}

function answered(state: FlowState, event: Extract<FlowEvent, { type: 'answered' }>): FlowResult {
  const option = event.optionId;
  if (event.kind === 'budget') {
    if (option === CHECKPOINT_OPTION.continueBudget && state.shipping) {
      return ship({ ...state, exceeded: null, resumeLast: false });
    }
    if (option === CHECKPOINT_OPTION.continueBudget && state.review.stop === 'budget') {
      return fixFindings({ ...state, exceeded: null, resumeLast: false });
    }
    if (option === CHECKPOINT_OPTION.continueBudget && state.last) {
      const next = state.resumeLast
        ? { ...state.last, escalate: false, reason: 'resume' as const }
        : state.last;
      return spawn({ ...state, exceeded: null, resumeLast: false }, next);
    }
    const limit = (state.exceeded ?? 'time').replace('_', ' ');
    return stopReport(state, `Stopped: the ${limit} budget ran out.`);
  }
  if (option === CHECKPOINT_OPTION.stop) return finish(state, 'cancelled', 'You stopped it.');
  if (event.kind === 'retry') {
    if (option === CHECKPOINT_OPTION.retry) return retry(state, event.note);
    return stopReport(
      state,
      `Stopped after ${MAX_REPAIR_RETRIES} retries; the step did not succeed.`,
    );
  }
  if (event.kind === 'stuck') {
    if (option === CHECKPOINT_OPTION.continueStuck) {
      return spawn(
        { ...state, retries: state.retries + 1, loop: null },
        { role: 'builder', reason: 'unstick', escalate: false, followUp: UNSTICK_NOTE },
      );
    }
    return stopReport(state, `Stopped: ${state.loop ?? 'the Builder was repeating itself'}.`);
  }
  if (event.kind === 'plan' && state.readOnly !== 'plan') {
    if (option !== CHECKPOINT_OPTION.makeChange)
      return finish(state, 'cancelled', 'You stopped it.');
    return build({ ...state, confirmFirst: null });
  }
  if (event.kind === 'plan') {
    const note = option === CHECKPOINT_OPTION.editPlan ? event.note?.trim() : null;
    return note ? writePlan(state, note) : finish(state, 'succeeded');
  }
  if (event.kind === 'verify') {
    if (option === CHECKPOINT_OPTION.retry) {
      return escalateOnce(state, escalateFollowUp(event.note ? [event.note] : []));
    }
    return afterBuilder(state, state.large);
  }
  if (event.kind === 'accept') {
    if (option === CHECKPOINT_OPTION.revert) {
      return { state: { ...state, waitingFor: null }, action: { type: 'revert' } };
    }
    if (option === CHECKPOINT_OPTION.fix) {
      return spawn(state, { role: 'builder', reason: 'fix', escalate: false, note: event.note });
    }
    if (option === CHECKPOINT_OPTION.fixFindings && canFixAgain(state.review)) {
      return fixFindings(state);
    }
    return finish(state, 'succeeded');
  }
  return finish(state, 'succeeded');
}

export function nextStep(state: FlowState, event: FlowEvent): FlowResult {
  switch (event.type) {
    case 'start':
      if (event.start === 'answer') return answer(state);
      if (event.start === 'plan') return writePlan(state, null);
      if (event.start === 'review') return reviewExisting(state);
      if (event.start === 'interpret') {
        return ask(state, 'clarify', 'The request does not say what to change.', {
          interpret: true,
        });
      }
      if (event.start === 'choose') {
        return ask(state, 'clarify', 'Not sure whether you want an answer or a change.', {
          answerOrBuild: true,
        });
      }
      return build(state);
    case 'clarified':
      if (event.answer === null) return finish(state, 'cancelled', 'You stopped it.');
      return event.answer ? answer(state) : build(state);
    case 'agent_done':
      return agentDone(state, event);
    case 'looped':
      return looped(state, event);
    case 'verified':
      return verified(state, event);
    case 'answered':
      return answered(state, event);
    case 'wrapped': {
      const facts = keepFacts(state, event.checksFailing === true);
      if (asksToKeep(state.level, event.filesChanged, facts)) {
        const why = keepReason(state.level, facts);
        const line = filesChangedLine(event.filesChanged);
        return ask(state, 'accept', why ? `${line} ${why}` : line);
      }
      if (shipsByItself(state.level, event.filesChanged)) return ship(state);
      if (keepsByItself(state.level, event.filesChanged)) {
        return { state: { ...state, waitingFor: null }, action: { type: 'keep' } };
      }
      return finish(state, 'succeeded');
    }
    case 'kept':
    case 'shipped':
      return finish(state, 'succeeded');
    case 'ship_held':
      return ask(state, 'accept', event.reason);
    case 'reverted':
      return finish({ ...state, open: [] }, 'succeeded', 'Reverted the changes.');
    case 'budget_exceeded':
      return ask(
        {
          ...state,
          exceeded: event.limit,
          resumeLast: event.unstarted !== true,
          review: refusedFix(state, event.unstarted === true)
            ? fixRefused(state.review)
            : state.review,
        },
        'budget',
        `The ${event.limit.replace('_', ' ')} budget ran out.`,
      );
    case 'stopped':
      return finish(state, 'cancelled', 'Stopped.');
  }
}

export function keepFacts(state: FlowState, checksFailing: boolean): KeepFacts {
  const critic = state.verdict !== null;
  return {
    checksFailing,
    criticUnsatisfied: critic && (state.verdict === 'unclear' || state.review.fixable.length > 0),
  };
}

function filesChangedLine(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'} changed.`;
}
