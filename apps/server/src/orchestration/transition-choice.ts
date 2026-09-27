import {
  MAX_REPAIR_RETRIES,
  type Gate,
  type TransitionNext,
  type TransitionStatus,
} from '@spark-outpost/contracts';
import { ASK_AT, gate } from '../advisor/gate.ts';
import { asksForRetry } from './checkpoint-policy.ts';
import { reviewWanted } from './depth.ts';
import { stepsLeftAfter } from './flow-steps.ts';
import type { AgentOutcome, FlowEvent, FlowState } from './transitions.ts';

export interface Transition {
  status: TransitionStatus;
  next: TransitionNext;
}

export interface JevTransition extends Transition {
  confidence: number;
}

export type Judged = Extract<FlowEvent, { type: 'judged' }>;

export interface TransitionChoice {
  event: Judged;
  gate: Gate | null;
}

export function stopsForUser(status: TransitionStatus): status is 'needs_you' | 'blocked' {
  return status === 'needs_you' || status === 'blocked';
}

export function ruleTransition(state: FlowState, outcome: AgentOutcome): Transition {
  if (outcome === 'failed') {
    return state.retries < MAX_REPAIR_RETRIES
      ? { status: 'needs_more_work', next: 'retry_up' }
      : { status: 'needs_you', next: 'finish' };
  }
  if (state.last?.role === 'critic') return { status: 'done', next: 'finish' };
  if (stepsLeftAfter(state)) return { status: 'done', next: 'next_step' };
  return {
    status: 'done',
    next: reviewWanted(state) && !state.reviewed ? 'review' : 'finish',
  };
}

export function wantsConfirm(state: FlowState, next: TransitionNext, confidence: number | null) {
  const unplannedReview = next === 'review' && !reviewWanted(state);
  if (next !== 'retry_up' && !unplannedReview) return false;
  return asksForRetry(state.level, confidence);
}

function applies(state: FlowState, pick: JevTransition, actAt: number): boolean {
  if (pick.confidence >= actAt) return true;
  if (pick.confidence < ASK_AT || stopsForUser(pick.status)) return false;
  return wantsConfirm(state, pick.next, pick.confidence);
}

export function chooseTransition(
  state: FlowState,
  outcome: AgentOutcome,
  pick: JevTransition | null,
): TransitionChoice {
  const rules = ruleTransition(state, outcome);
  const byRules: Judged = { type: 'judged', ...rules, rules, source: 'rules', confidence: null };
  if (!pick) return { event: byRules, gate: null };
  const decision = gate({ confidence: pick.confidence }, state.risk, state.level);
  if (!applies(state, pick, decision.actAt)) return { event: byRules, gate: decision };
  return {
    event: {
      type: 'judged',
      status: pick.status,
      next: pick.next,
      rules,
      source: 'jev',
      confidence: pick.confidence,
    },
    gate: decision,
  };
}
