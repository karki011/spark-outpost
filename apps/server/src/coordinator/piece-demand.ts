import {
  PIECE_BELOW_CHAT_KIND_CONFIDENCE,
  PIECE_BELOW_CHAT_KINDS,
  PIECE_BELOW_CHAT_MAX_CODING,
  PIECE_BELOW_CHAT_MAX_REASONING,
  PIECE_BELOW_CHAT_MAX_RELIABILITY,
  PIECE_BELOW_CHAT_MEASURED_MIN,
  PIECE_BELOW_CHAT_MIN_CONFIDENCE,
  PIECE_BELOW_CHAT_PASS_MARGIN,
  PIECE_CAPABILITY_LEAD,
  PIECE_DEEP_REASONING_AT,
  PIECE_DEMAND_WEIGHTS,
  PIECE_KIND_MIN_CONFIDENCE,
  PIECE_LARGE_CONTEXT_TOKENS,
  PIECE_MID_AT,
  PIECE_PASS_RATE_MARGIN,
  PIECE_PRICE_MARGIN,
  PIECE_RELIABILITY_TOP_AT,
  PIECE_SIGNAL_MIN_CONFIDENCE,
  PIECE_TOP_AT,
} from '../advisor/policy.ts';
import type { PieceAnswer, RouteOption, ScoreSignal, TaskKind } from './piece-questions.ts';

export type DemandTier = 'low' | 'mid' | 'top';
export type Capability = 'reasoning' | 'coding' | 'context' | 'balanced';

export interface PieceFacts {
  destructive: boolean;
  core: boolean | null;
}

export interface Demand {
  score: number | null;
  tier: DemandTier;
  capability: Capability;
  kind: TaskKind | null;
  signals: string;
  raisedBy: string | null;
}

export type DemandResult = { ok: true; demand: Demand } | { ok: false; reason: string };

export interface RoutePick {
  route: RouteOption;
  why: string;
}

const TIER_RANK: Readonly<Record<string, number>> = { micro: 0, low: 1, mid: 2, top: 3 };
const DEMAND_TIERS: readonly DemandTier[] = ['low', 'mid', 'top'];

const STRENGTH_WORDS: Readonly<Record<Exclude<Capability, 'balanced'>, RegExp>> = {
  reasoning: /reason|complex|hard|planning|debug|systems engineering/i,
  coding: /\bcod(?:e|ing)\b/i,
  context: /context/i,
};

function usable(signal: ScoreSignal | null): signal is ScoreSignal {
  return signal !== null && signal.confidence >= PIECE_SIGNAL_MIN_CONFIDENCE;
}

function unsure(label: string, signal: ScoreSignal | null): string {
  if (!signal) return `Jev gave no ${label}`;
  return `Jev was unsure (${label} ${signal.confidence.toFixed(2)})`;
}

function rounded(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function kindOf(answer: PieceAnswer): TaskKind | null {
  const kind = answer.kind;
  if (typeof kind === 'string' || kind.confidence < PIECE_KIND_MIN_CONFIDENCE) return null;
  return kind.choice as TaskKind;
}

export function riskyAnswer(answer: PieceAnswer): boolean {
  return kindOf(answer) === 'migrate' || (answer.reliability ?? 0) >= PIECE_RELIABILITY_TOP_AT;
}

function weighted(answer: PieceAnswer): number | null {
  const parts = [
    { signal: answer.reasoning, weight: PIECE_DEMAND_WEIGHTS.reasoning },
    { signal: answer.coding, weight: PIECE_DEMAND_WEIGHTS.coding },
    { signal: answer.context, weight: PIECE_DEMAND_WEIGHTS.context },
  ].filter((part) => usable(part.signal));
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  if (total === 0) return null;
  return parts.reduce((sum, part) => sum + part.signal!.mean * part.weight, 0) / total;
}

function scoredTier(score: number): DemandTier {
  if (score >= PIECE_TOP_AT) return 'top';
  if (score >= PIECE_MID_AT) return 'mid';
  return 'low';
}

function floorOf(answer: PieceAnswer, facts: PieceFacts, kind: TaskKind | null) {
  if (facts.destructive) return { tier: 'top' as const, why: 'destructive' };
  if (kind === 'migrate') return { tier: 'top' as const, why: 'data migration' };
  if ((answer.reliability ?? 0) >= PIECE_RELIABILITY_TOP_AT) {
    return { tier: 'top' as const, why: 'must be right first time' };
  }
  if (usable(answer.reasoning) && answer.reasoning.mean >= PIECE_DEEP_REASONING_AT) {
    return { tier: 'top' as const, why: 'deep reasoning' };
  }
  if (kind === 'refactor' && facts.core) return { tier: 'mid' as const, why: 'core refactor' };
  return null;
}

function capabilityOf(answer: PieceAnswer): Capability {
  const ranked = (['reasoning', 'coding', 'context'] as const)
    .filter((key) => usable(answer[key]))
    .map((key) => ({ key, mean: answer[key]!.mean }))
    .sort((a, b) => b.mean - a.mean);
  const [first, second] = ranked;
  if (!first || first.mean < PIECE_MID_AT) return 'balanced';
  if (second && first.mean - second.mean < PIECE_CAPABILITY_LEAD) return 'balanced';
  return first.key;
}

function signalsText(answer: PieceAnswer): string {
  const parts = (['reasoning', 'coding', 'context'] as const).flatMap((key) =>
    usable(answer[key]) ? [`${key} ${rounded(answer[key]!.mean)}`] : [],
  );
  if (answer.reliability !== null && answer.reliability >= PIECE_RELIABILITY_TOP_AT) {
    parts.push('high stakes');
  }
  return parts.join(', ');
}

function unsureReason(answer: PieceAnswer): string | null {
  if (!usable(answer.reasoning)) return unsure('reasoning', answer.reasoning);
  if (!usable(answer.coding)) return unsure('coding', answer.coding);
  return null;
}

export function pieceDemand(answer: PieceAnswer, facts: PieceFacts): DemandResult {
  const kind = kindOf(answer);
  const floor = floorOf(answer, facts, kind);
  const doubt = unsureReason(answer);
  if (doubt && floor?.tier !== 'top') return { ok: false, reason: doubt };
  const score = weighted(answer);
  const scored = doubt || score === null ? 'low' : scoredTier(score);
  const raised = floor !== null && TIER_RANK[floor.tier]! > TIER_RANK[scored]!;
  return {
    ok: true,
    demand: {
      score,
      tier: raised ? floor.tier : scored,
      capability: capabilityOf(answer),
      kind,
      signals: signalsText(answer),
      raisedBy: raised ? floor.why : null,
    },
  };
}

export interface KindPassRates {
  below: number;
  chat: number;
  runs: number;
}

export const NOT_CLEARLY_SIMPLE = 'not clearly simple, so not below the chat model';
export const MEASURED_BELOW_CHAT = 'measured pass rate below the chat model';

function simpleScore(signal: ScoreSignal | null, max: number): boolean {
  return (
    signal !== null && signal.confidence >= PIECE_BELOW_CHAT_MIN_CONFIDENCE && signal.mean <= max
  );
}

function simpleKind(answer: PieceAnswer): boolean {
  const kind = answer.kind;
  if (typeof kind === 'string' || kind.confidence < PIECE_BELOW_CHAT_KIND_CONFIDENCE) return false;
  return (PIECE_BELOW_CHAT_KINDS as readonly string[]).includes(kind.choice);
}

export function clearlySimple(answer: PieceAnswer, facts: PieceFacts): boolean {
  if (simpleKind(answer)) return true;
  return (
    simpleScore(answer.reasoning, PIECE_BELOW_CHAT_MAX_REASONING) &&
    simpleScore(answer.coding, PIECE_BELOW_CHAT_MAX_CODING) &&
    answer.reliability !== null &&
    answer.reliability < PIECE_BELOW_CHAT_MAX_RELIABILITY &&
    facts.core !== true
  );
}

function measuredEnough(measured: KindPassRates | null): measured is KindPassRates {
  return measured !== null && measured.runs >= PIECE_BELOW_CHAT_MEASURED_MIN;
}

export function belowChatBlock(simple: boolean, measured: KindPassRates | null): string | null {
  if (measuredEnough(measured)) {
    const holds = measured.below >= measured.chat - PIECE_BELOW_CHAT_PASS_MARGIN;
    return holds ? null : MEASURED_BELOW_CHAT;
  }
  return simple ? null : NOT_CLEARLY_SIMPLE;
}

function isDemandTier(tier: string): tier is DemandTier {
  return (DEMAND_TIERS as readonly string[]).includes(tier);
}

export function atChatTier(
  demand: Demand,
  chosen: RoutePick,
  chatTier: string | null,
  block: string | null,
): Demand | null {
  if (block === null || chatTier === null || !isDemandTier(chatTier)) return null;
  if (TIER_RANK[chosen.route.tier]! >= TIER_RANK[chatTier]!) return null;
  return { ...demand, tier: chatTier, raisedBy: block };
}

function fits(route: RouteOption, capability: Capability): boolean {
  if (capability === 'balanced') return false;
  if (capability === 'context' && (route.contextTokens ?? 0) >= PIECE_LARGE_CONTEXT_TOKENS) {
    return true;
  }
  return route.strengths.some((strength) => STRENGTH_WORDS[capability].test(strength));
}

interface Verdict {
  winner: -1 | 1;
  why: string;
}

type Comparison = Verdict | null;

function byPassRate(a: RouteOption, b: RouteOption): Comparison {
  if (a.passRate === null || b.passRate === null) return null;
  if (Math.abs(a.passRate - b.passRate) < PIECE_PASS_RATE_MARGIN) return null;
  return { winner: a.passRate > b.passRate ? -1 : 1, why: 'best pass rate' };
}

function byFit(a: RouteOption, b: RouteOption, capability: Capability): Comparison {
  const fitA = fits(a, capability);
  if (fitA === fits(b, capability)) return null;
  return { winner: fitA ? -1 : 1, why: `strong at ${capability}` };
}

function byPrice(a: RouteOption, b: RouteOption): Comparison {
  if (a.priceUsd === null || b.priceUsd === null) return null;
  const cheaper = Math.min(a.priceUsd, b.priceUsd);
  if (Math.abs(a.priceUsd - b.priceUsd) <= cheaper * PIECE_PRICE_MARGIN) return null;
  return { winner: a.priceUsd < b.priceUsd ? -1 : 1, why: 'cheapest' };
}

function compare(a: RouteOption, b: RouteOption, demand: Demand): Verdict {
  return (
    byPassRate(a, b) ??
    byFit(a, b, demand.capability) ??
    byPrice(a, b) ?? { winner: -1, why: 'listed first' }
  );
}

function tierRoutes(routes: readonly RouteOption[], tier: DemandTier): RouteOption[] {
  const from = DEMAND_TIERS.indexOf(tier);
  for (const step of DEMAND_TIERS.slice(from)) {
    const found = routes.filter((route) => route.tier === step);
    if (found.length > 0) return found;
  }
  return [];
}

export function pickForDemand(demand: Demand, routes: readonly RouteOption[]): RoutePick | null {
  const pool = tierRoutes(routes, demand.tier);
  if (pool.length === 0) return null;
  if (pool.length === 1) return { route: pool[0]!, why: `only ${pool[0]!.tier}-tier route` };
  const better = (a: RouteOption, b: RouteOption) => (compare(a, b, demand).winner === -1 ? a : b);
  const best = pool.reduce(better);
  const second = pool.filter((route) => route !== best).reduce(better);
  return { route: best, why: compare(best, second, demand).why };
}
