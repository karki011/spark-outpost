import type { ModelCard, ModelStat, ModelTier } from '@spark-outpost/contracts';
import {
  ROUTE_ADEQUATE_LOSS,
  ROUTE_FAILURE,
  ROUTE_MEASURED_MIN,
  ROUTE_REPAIR_USD,
  ROUTE_SIZE_WEIGHT,
  ROUTE_STAKES_WEIGHT,
  ROUTE_TOKEN_MIX,
  ROUTE_TRAJECTORY_MTOK,
  ROUTE_UNCLEAR_STEP,
} from '../advisor/policy.ts';
import { usableStats } from '../model-cards/card-text.ts';
import { cardFor, TIER_RANK } from '../model-cards/cards.ts';
import { switchCostUsd, usd, type ResumableSession } from './cache-switch.ts';
import { signalText, type TaskSignals } from './task-signals.ts';
import type { TierModel } from './tiers.ts';

export interface ScoredModel {
  id: string;
  label: string;
  tier: ModelTier;
  quality: number;
  costUsd: number;
  switchUsd: number;
  utility: number;
}

export interface RouteScore {
  signals: TaskSignals;
  repairUsd: number;
  ranked: ScoredModel[];
  pick: ScoredModel;
  base: ScoredModel;
  anchor: 'chat' | 'session';
}

export interface ScoreInput {
  provider: string;
  models: readonly TierModel[];
  chat: TierModel;
  session: ResumableSession | null;
  signals: TaskSignals;
  stats: readonly ModelStat[];
  now: Date;
}

const level = (value: number) => Math.min(5, Math.max(1, Math.round(value))) - 1;

export function repairUsd(signals: TaskSignals): number {
  return (
    ROUTE_REPAIR_USD *
    ROUTE_STAKES_WEIGHT[level(signals.stakes.value)]! *
    ROUTE_SIZE_WEIGHT[level(signals.complexity.value)]!
  );
}

function unclear(value: number): number {
  return 1 + ROUTE_UNCLEAR_STEP * Math.max(0, value - 2);
}

function wilsonLower(failures: number, n: number): number {
  const z = 1.96;
  const p = failures / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - spread) / (1 + (z * z) / n));
}

function measuredFailure(card: ModelCard, stats: readonly ModelStat[], now: Date): number {
  const rows = usableStats(stats, now).filter(
    (stat) => stat.provider === card.provider && stat.model === card.id && stat.role === 'builder',
  );
  const n = rows.reduce((sum, row) => sum + row.n, 0);
  if (n < ROUTE_MEASURED_MIN) return 0;
  const passed = rows.reduce((sum, row) => sum + row.passed, 0);
  return wilsonLower(n - passed, n);
}

export function failureRate(
  card: ModelCard,
  signals: TaskSignals,
  stats: readonly ModelStat[] = [],
  now: Date = new Date(),
): number {
  const table = ROUTE_FAILURE[card.tier][level(signals.complexity.value)]!;
  const rated = table * unclear(signals.ambiguity.value) * unclear(signals.contextDependence.value);
  return Math.min(0.95, Math.max(rated, measuredFailure(card, stats, now)));
}

export function trajectoryUsd(card: ModelCard, signals: TaskSignals): number | null {
  const price = card.price;
  if (!price) return null;
  const blended =
    ROUTE_TOKEN_MIX.cachedRead * price.cachedInputPerMillion +
    ROUTE_TOKEN_MIX.cacheWrite * (price.cacheWritePerMillion ?? price.inputPerMillion) +
    ROUTE_TOKEN_MIX.output * price.outputPerMillion;
  return ROUTE_TRAJECTORY_MTOK[level(signals.complexity.value)]! * blended;
}

function scoreModel(model: TierModel, input: ScoreInput, repair: number): ScoredModel | null {
  const card = cardFor(model, input.provider);
  const cost = card ? trajectoryUsd(card, input.signals) : null;
  if (!card || cost === null) return null;
  const switchUsd = input.session ? switchCostUsd(input.session, model, input.now) : 0;
  if (switchUsd === null) return null;
  const quality = 1 - failureRate(card, input.signals, input.stats, input.now);
  const costUsd = cost + switchUsd;
  return {
    id: model.id,
    label: model.label,
    tier: card.tier,
    quality,
    costUsd,
    switchUsd,
    utility: quality - costUsd / repair,
  };
}

function pool(input: ScoreInput): TierModel[] {
  const sessionModel = input.session
    ? { id: input.session.pick.model ?? '', label: input.session.pick.modelLabel ?? '' }
    : null;
  const all = [input.chat, ...(sessionModel ? [sessionModel] : []), ...input.models];
  return all.filter((model, index) => all.findIndex((other) => other.id === model.id) === index);
}

function allowed(model: ScoredModel, base: ScoredModel, anchor: RouteScore['anchor']): boolean {
  if (TIER_RANK[model.tier] >= TIER_RANK[base.tier]) return true;
  if (anchor === 'session') return false;
  return base.quality - model.quality < ROUTE_ADEQUATE_LOSS;
}

export function scoreRoute(input: ScoreInput): RouteScore | null {
  const repair = repairUsd(input.signals);
  const scored = pool(input)
    .map((model) => scoreModel(model, input, repair))
    .filter((model): model is ScoredModel => model !== null);
  const anchor = input.session ? 'session' : 'chat';
  const baseId = input.session ? input.session.pick.model : input.chat.id;
  const base = scored.find((model) => model.id === baseId);
  if (!base) return null;
  const ranked = scored.sort(
    (a, b) => b.utility - a.utility || Number(b.id === base.id) - Number(a.id === base.id),
  );
  const pick = ranked.find((model) => allowed(model, base, anchor)) ?? base;
  return { signals: input.signals, repairUsd: repair, ranked, pick, base, anchor };
}

function modelText(model: ScoredModel): string {
  const moving = model.switchUsd > 0 ? ` incl. ${usd(model.switchUsd)} switch` : '';
  return `${model.label} ${model.utility.toFixed(3)} (q ${model.quality.toFixed(3)}, ${usd(model.costUsd)}${moving})`;
}

export const SCORED_MODELS = 3;

export function scoreText(score: RouteScore): string {
  const ranked = score.ranked.slice(0, SCORED_MODELS).map(modelText).join(', ');
  return `score ${signalText(score.signals)}; repair ${usd(score.repairUsd)}: ${ranked}`;
}
