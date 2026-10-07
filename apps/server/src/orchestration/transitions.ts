import type { FlowEvent, FlowResult, FlowState, Spawn } from './flow-types.ts';
import {
  CHECKPOINT_OPTION,
  MAX_REPAIR_RETRIES,
  needsYouLine,
  providerIssueKind,
  type AgentRole,
  type OrchestrationPhase,
} from '@spark-outpost/contracts';
import { MAX_VERDICTS, PLAN_CONTINUES } from '../advisor/policy.ts';
import {
  asksToKeep,
  keepReason,
  filesChangedLine,
  keepFacts,
  keepsByItself,
  keptLine,
  shipsByItself,
} from './checkpoint-policy.ts';
import { cascadeAction, DECLINED_REASON, UNCONFIRMED_REASON } from './cascade.ts';
import { criticFixFollowUp } from './context.ts';
import { askAgent, reviewExisting } from './read-only-flow.ts';
import {
  afterReview,
  canFixAgain,
  checksFailedAfterFix,
  lastAction,
  startFix,
} from './review-loop.ts';

export type {
  AgentOutcome,
  FlowAction,
  FlowEvent,
  FlowResult,
  FlowState,
  Spawn,
  SpawnReason,
  StartMode,
} from './flow-types.ts';
export { initialFlow } from './flow-types.ts';

const PHASE_FOR_ROLE: Record<AgentRole, OrchestrationPhase> = {
  scout: 'scouting',
  architect: 'planning',
  builder: 'building',
  critic: 'reviewing',
  coordinator: 'planning',
  integrator: 'building',
  spark: 'scouting',
};

function spawn(state: FlowState, next: Omit<Spawn, 'note'> & { note?: string | null }): FlowResult {
  const full: Spawn = { ...next, note: next.note ?? null };
  return {
    state: { ...state, phase: PHASE_FOR_ROLE[full.role], last: full, waitingFor: null },
    action: { type: 'spawn', ...full },
  };
}

function askToKeep(state: FlowState, reason: string): FlowResult {
  return {
    state: { ...state, phase: 'waiting', waitingFor: 'accept' },
    action: { type: 'ask', reason },
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
  const lines = status === 'cancelled' ? [] : [incompleteLine(state.open), state.needsYou ?? null];
  const incomplete = lines.filter((line) => line !== null).join('\n\n') || null;
  return {
    state: { ...state, phase: 'finished', waitingFor: null },
    action: { type: 'finish', status, reason, ...(incomplete ? { incomplete } : {}) },
  };
}

function ship(state: FlowState, keptNote: string | null = null): FlowResult {
  const action = { type: 'ship' as const, ...(keptNote ? { keptNote } : {}) };
  return { state: { ...state, waitingFor: null, shipping: true }, action };
}

function wrapUp(state: FlowState): FlowResult {
  return { state: { ...state, waitingFor: null }, action: { type: 'wrap_up' } };
}

export function continueFollowUp(open: readonly string[]): string {
  return `You stopped before finishing: ${listText(open)} ${open.length === 1 ? 'is' : 'are'} still open in your plan. Continue with ${open.length === 1 ? 'it' : 'them'} now, then reply with what you changed.`;
}

function build(state: FlowState): FlowResult {
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
  if (state.solo) return wrapUp(state);
  if (state.review.fixing) {
    return spawn(state, { role: 'critic', reason: 'recheck', escalate: false });
  }
  if ((state.reviewWanted || large) && !state.reviewed && !state.unchanged) {
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

function needsYou(state: FlowState, reason: string): FlowResult {
  return finish({ ...state, needsYou: needsYouLine(reason) }, 'succeeded');
}

function signedOut(error: string | null | undefined): boolean {
  return typeof error === 'string' && providerIssueKind(error) === 'auth';
}

function builderDone(
  state: FlowState,
  event: Extract<FlowEvent, { type: 'agent_done' }>,
): FlowResult {
  const next = {
    ...state,
    open: [...(event.open ?? state.open)],
    missingContext: event.missingContext ?? null,
    unchanged: event.unchanged === true,
  };
  if (event.outcome === 'failed' && (state.solo || signedOut(event.error))) {
    return finish(next, 'failed', event.error ?? 'The agent hit a problem.');
  }
  if (event.outcome === 'failed' && next.missingContext) return askContext(next);
  if (event.outcome === 'failed') {
    if (next.retries < MAX_REPAIR_RETRIES) return retry(next);
    return needsYou(next, `Stopped after ${MAX_REPAIR_RETRIES} retries.`);
  }
  if (!state.solo && next.open.length > 0 && next.continues < PLAN_CONTINUES) {
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

export function escalateFollowUp(reasons: readonly string[]): string {
  const missing =
    reasons.length > 0
      ? ` These requirements look unmet: ${listText(reasons)}.`
      : ' A stated case, value or edge case looks missing or different from what was asked.';
  return `An independent check of your change against the request found that it does not yet do everything asked.${missing} Re-read the request, finish what is missing without undoing what works, then reply with what you changed.`;
}

function escalateOnce(state: FlowState, followUp: string): FlowResult {
  return spawn(
    { ...state, escalated: true },
    { role: 'builder', reason: 'escalate', escalate: true, followUp },
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

function askContext(state: FlowState): FlowResult {
  const missing = state.missingContext ?? '';
  if (state.level === 'full-auto') {
    return stopReport(state, `Stopped: the Builder is missing context. ${missing}`);
  }
  return needsYou(state, missing);
}

function verified(state: FlowState, event: Extract<FlowEvent, { type: 'verified' }>): FlowResult {
  const next = { ...state, verdicts: state.verdicts + 1 };
  const action = cascadeAction(event.accepted, state.escalated, event.evidence);
  if (action !== 'finish' && next.missingContext) return askContext(next);
  if (action === 'escalate') return escalateOnce(next, escalateFollowUp(event.reasons));
  if (action === 'ask') {
    const reason = event.accepted === 'unsupported' ? UNCONFIRMED_REASON : DECLINED_REASON;
    return afterBuilder({ ...next, needsYou: needsYouLine(reason), unverified: true }, state.large);
  }
  return afterBuilder(next, state.large);
}

export const CRITIC_UNAVAILABLE = 'critic unavailable';

function criticFailed(state: FlowState, error: string | null | undefined): FlowResult {
  if (!state.criticRetried) {
    return spawn(
      { ...state, criticRetried: true },
      { role: 'critic', reason: 'retry', escalate: false },
    );
  }
  const review = afterReview(state.review, 'unclear', []);
  return wrapUp({ ...state, review, criticSkipped: error?.trim() || CRITIC_UNAVAILABLE });
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
  if (event.role === 'critic' && event.outcome === 'failed')
    return criticFailed(state, event.error);
  if (event.role === 'critic') {
    const verdict = event.verdict ?? 'unclear';
    const review = afterReview(state.review, verdict, event.fixable ?? []);
    const next = { ...state, verdict, review };
    return lastAction(review) === 'fix' ? fixFindings(next) : wrapUp(next);
  }
  return builderDone(state, event);
}

function looped(state: FlowState, event: Extract<FlowEvent, { type: 'looped' }>): FlowResult {
  const next = { ...state, loop: event.summary, open: [...(event.open ?? state.open)] };
  return stopReport(next, `Stopped: ${event.summary}.`);
}

function answered(state: FlowState, event: Extract<FlowEvent, { type: 'answered' }>): FlowResult {
  const option = event.optionId;
  if (option === CHECKPOINT_OPTION.stop) return finish(state, 'cancelled', 'You stopped it.');
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

export function nextStep(state: FlowState, event: FlowEvent): FlowResult {
  switch (event.type) {
    case 'start':
      if (event.start === 'answer') return answer(state);
      if (event.start === 'review') return reviewExisting(state);
      if (event.start === 'ask_agent') return askAgent(state);
      return build(state);
    case 'agent_done':
      return agentDone(state, event);
    case 'looped':
      return looped(state, event);
    case 'verified':
      return verified(state, event);
    case 'answered':
      return answered(state, event);
    case 'wrapped': {
      const facts = {
        ...keepFacts(state, event.checksFailing === true, event.riskyMigration ?? null),
        outsideWorktree: event.outsideWorktree === true,
      };
      if (asksToKeep(state.level, event.filesChanged, facts)) {
        const why = keepReason(state.level, facts);
        const line = filesChangedLine(event.filesChanged);
        return askToKeep(state, why ? `${line} ${why}` : line);
      }
      if (shipsByItself(state.level, event.filesChanged)) return ship(state, keptLine(facts));
      if (keepsByItself(state.level, event.filesChanged)) {
        const note = keptLine(facts);
        const action = { type: 'keep' as const, ...(note ? { note } : {}) };
        return { state: { ...state, waitingFor: null }, action };
      }
      return finish(state, 'succeeded');
    }
    case 'kept':
    case 'shipped':
      return finish(state, 'succeeded');
    case 'ship_held':
      return askToKeep(state, event.reason);
    case 'reverted':
      return finish({ ...state, open: [] }, 'succeeded', 'Reverted the changes.');
    case 'stopped':
      return finish(state, 'cancelled', 'Stopped.');
  }
}
