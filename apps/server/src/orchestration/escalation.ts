import type { AgentPick } from '@spark-outpost/contracts';
import {
  COMPACT_CONTEXT_DEPENDENCE,
  ESCALATE_AT,
  HANDOFF_CONTEXT_TOKENS,
  RAISE_EFFORT_AT,
} from '../advisor/policy.ts';
import { effortKeepsCache, TIER_RANK } from '../model-cards/cards.ts';
import {
  contextText,
  handoffCostUsd,
  keptText,
  labelOf,
  leftText,
  sessionWarm,
  switchCostUsd,
  type ResumableSession,
  type SessionChoice,
} from './cache-switch.ts';
import { scoreRoute, type RouteScore, type ScoreInput } from './route-score.ts';
import type { TaskSignals } from './task-signals.ts';
import { strongerEffort } from './tiers.ts';

export type EscalationKind = 'stay' | 'effort' | 'switch' | 'brief' | 'compact';

export const HANDOFF_KINDS: ReadonlySet<EscalationKind> = new Set(['brief', 'compact']);
export const ESCALATED_KINDS: ReadonlySet<EscalationKind> = new Set(['switch', 'brief', 'compact']);

export interface PriorEscalation {
  kind: EscalationKind;
  model: string;
  modelLabel: string | null;
  unseen: boolean;
}

export interface Escalation {
  kind: EscalationKind;
  hard: boolean;
  sticky: boolean;
  contextTokens: number;
  cacheWarm: boolean;
  from: AgentPick;
  to: { model: string; modelLabel: string; effort: string | null };
  fullSwitchUsd: number | null;
  handoffUsd: number | null;
}

export interface EscalatedScore {
  score: RouteScore;
  escalation: Escalation | null;
  stayedOn: string | null;
}

export function isHard(signals: TaskSignals): boolean {
  return signals.complexity.value >= ESCALATE_AT || signals.stakes.value >= ESCALATE_AT;
}

function handoffKind(signals: TaskSignals, contextTokens: number): EscalationKind {
  if (contextTokens < HANDOFF_CONTEXT_TOKENS) return 'switch';
  return signals.contextDependence.value >= COMPACT_CONTEXT_DEPENDENCE ? 'compact' : 'brief';
}

function withPick(score: RouteScore, id: string): RouteScore {
  const pick = score.ranked.find((model) => model.id === id);
  return pick ? { ...score, pick } : score;
}

function stayOnPrior(score: RouteScore, prior: PriorEscalation | null): EscalatedScore {
  const kept = { score, escalation: null, stayedOn: null };
  if (!prior || !ESCALATED_KINDS.has(prior.kind) || prior.kind === 'brief') return kept;
  const earlier = score.ranked.find((model) => model.id === prior.model);
  if (!earlier || TIER_RANK[score.pick.tier] >= TIER_RANK[earlier.tier]) return kept;
  return { score: { ...score, pick: earlier }, escalation: null, stayedOn: earlier.label };
}

interface Decision {
  kind: EscalationKind;
  score: RouteScore;
  sticky: boolean;
  effort: string | null;
}

function decide(
  input: ScoreInput & { session: ResumableSession },
  full: RouteScore,
  prior: PriorEscalation | null,
  efforts: readonly string[],
): Decision {
  const { session, signals } = input;
  const stayId = session.pick.model;
  const hard = isHard(signals);
  const handoff = hard
    ? scoreRoute({ ...input, switchUsd: (model) => handoffCostUsd(session, model) })
    : null;
  const kind = handoffKind(signals, session.contextTokens);
  const plain = { sticky: false, effort: null };
  if (handoff && kind !== 'switch' && handoff.pick.id !== stayId) {
    return { kind, score: handoff, ...plain };
  }
  if (full.pick.id !== stayId) return { kind: 'switch', score: full, ...plain };
  if (handoff && prior?.kind === 'brief' && prior.model !== stayId) {
    const sticky = withPick(handoff, prior.model);
    if (sticky.pick.id === prior.model) {
      return { kind: 'brief', score: sticky, sticky: true, effort: null };
    }
  }
  const model = { id: stayId ?? '', label: session.pick.modelLabel ?? '' };
  if (
    signals.complexity.value >= RAISE_EFFORT_AT &&
    effortKeepsCache(model, session.pick.provider)
  ) {
    const raised = strongerEffort(efforts, session.pick.effort);
    if (raised && raised !== session.pick.effort) {
      return { kind: 'effort', score: full, sticky: false, effort: raised };
    }
  }
  return { kind: 'stay', score: full, ...plain };
}

export const MEASURED_ARMS = ['stay', 'switch', 'compact', 'brief'] as const;
export type MeasuredArm = (typeof MEASURED_ARMS)[number];

function strongest(score: RouteScore): RouteScore {
  const top = [...score.ranked].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])[0];
  return top ? { ...score, pick: top } : score;
}

function forced(
  input: ScoreInput & { session: ResumableSession },
  full: RouteScore,
  arm: MeasuredArm,
): Decision {
  const plain = { kind: arm, sticky: false, effort: null };
  if (arm === 'stay') return { ...plain, score: withPick(full, input.session.pick.model ?? '') };
  if (arm === 'switch') return { ...plain, score: strongest(full) };
  const handoff = scoreRoute({
    ...input,
    switchUsd: (model) => handoffCostUsd(input.session, model),
  });
  return { ...plain, score: strongest(handoff ?? full) };
}

export function scoreEscalation(
  input: ScoreInput,
  prior: PriorEscalation | null,
  efforts: readonly string[],
  arm: MeasuredArm | null = null,
): EscalatedScore | null {
  const full = scoreRoute(input);
  if (!full) return null;
  const session = input.session;
  if (!session) return stayOnPrior(full, prior);
  const decision = arm
    ? forced({ ...input, session }, full, arm)
    : decide({ ...input, session }, full, prior, efforts);
  const target = { id: decision.score.pick.id, label: decision.score.pick.label };
  const escalation: Escalation = {
    kind: decision.kind,
    hard: isHard(input.signals),
    sticky: decision.sticky,
    contextTokens: session.contextTokens,
    cacheWarm: sessionWarm(session, input.now),
    from: session.pick,
    to: {
      model: target.id,
      modelLabel: target.label,
      effort: decision.effort,
    },
    fullSwitchUsd: switchCostUsd(session, target, input.now),
    handoffUsd: handoffCostUsd(session, target),
  };
  return { score: decision.score, escalation, stayedOn: null };
}

function kilo(tokens: number): string {
  return `${Math.round(tokens / 1_000)}K`;
}

function fromLabel(escalation: Escalation): string {
  return escalation.from.modelLabel ?? escalation.from.model ?? 'the agent default';
}

export function escalationRule(escalation: Escalation): string | null {
  const at = kilo(escalation.contextTokens);
  const to = escalation.to.modelLabel;
  if (escalation.kind === 'brief') {
    const again = escalation.sticky ? ' again' : '';
    return `hard follow-up at ${at} → ${to} Builder with brief${again}; ${fromLabel(escalation)} session kept warm`;
  }
  if (escalation.kind === 'compact') {
    return `hard follow-up at ${at} → compacted handoff; session moves to ${to}`;
  }
  return null;
}

export function stayedRule(label: string): string {
  return `stayed on ${label}: escalated earlier in this task`;
}

export function escalationChoice(
  escalation: Escalation,
  session: ResumableSession,
  now: Date,
): SessionChoice | null {
  const context = contextText(session.contextTokens);
  if (escalation.kind === 'brief') {
    const reason = `kept the ${sessionWarm(session, now) ? 'warm' : 'resumable'} ${labelOf(session)} session for later turns (${context})`;
    return { kept: true, reason, session: session.pick };
  }
  if (escalation.kind === 'compact') {
    return {
      kept: false,
      reason: leftText('compacted handoff', session, now),
      session: session.pick,
    };
  }
  if (escalation.kind === 'effort') {
    const effort = `effort ${session.pick.effort ?? 'default'} → ${escalation.to.effort}`;
    const reason = `${keptText(session, now)}; ${effort} (the cache survives an effort change)`;
    return { kept: true, reason, session: session.pick };
  }
  return null;
}
