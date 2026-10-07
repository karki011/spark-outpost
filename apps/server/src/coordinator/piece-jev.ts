import type { AgentPick, PiecePlacement } from '@spark-outpost/contracts';
import type { AdvisorOption } from '../advisor/advice.ts';
import { selectableModels } from '../advisor/intake-questions.ts';
import { COORD_POLICY_VERSION, ROUTE_TOKEN_MIX, ROUTER_TIERS } from '../advisor/policy.ts';
import { cardFor } from '../model-cards/cards.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { builderModels } from '../orchestration/model-floor.ts';
import type { Session } from '../orchestration/session.ts';
import { routeCandidates } from '../routing/candidates.ts';
import { measuredRate, measuredStrength, type AssignFacts } from './assign.ts';
import { destructivePath, JEV_NOT_CONNECTED, type BuilderPlan } from './builder-jev.ts';
import type { KindPassRates } from './piece-demand.ts';
import type { ListPlace } from './place-list.ts';
import { factPaths, loadFileFacts, type FileFacts } from './piece-facts.ts';
import { touchesCore, type RouteOption, type TaskKind } from './piece-questions.ts';
import {
  routePieceList,
  type JevOutcome,
  type PieceRoute,
  type RoutedPieces,
  type RouteRules,
} from './piece-routes.ts';
import type { CheckedPiece } from './pieces-validate.ts';

export interface PiecePicks extends RoutedPieces {
  reason: string;
  notes: Map<string, string | null>;
}

function blendedPrice(model: AdvisorOption, provider: string): number | null {
  const price = cardFor(model, provider)?.price;
  if (!price) return null;
  return (
    ROUTE_TOKEN_MIX.cachedRead * price.cachedInputPerMillion +
    ROUTE_TOKEN_MIX.cacheWrite * (price.cacheWritePerMillion ?? price.inputPerMillion) +
    ROUTE_TOKEN_MIX.output * price.outputPerMillion
  );
}

function offeredRoutes(s: Session, facts: AssignFacts): RouteOption[] {
  const now = s.route.now ?? new Date();
  return routeCandidates(s.route.candidates).flatMap((route) => {
    const candidate = s.route.candidates.find((entry) => entry.provider === route.provider)!;
    if (facts.unhealthy.has(route.provider)) return [];
    const floorOk = builderModels(selectableModels(candidate), route.provider, now).some(
      (model) => model.id === route.model,
    );
    if (!floorOk) return [];
    const model = selectableModels(candidate).find((option) => option.id === route.model)!;
    const card = cardFor(model, route.provider);
    const passRate = measuredStrength(candidate, route.model) ?? measuredStrength(candidate);
    return [
      {
        ...route,
        passRate,
        strengths: card?.strengths ?? [],
        contextTokens: card?.contextTokens ?? null,
        priceUsd: blendedPrice(model, route.provider),
      },
    ];
  });
}

const MEASURED_CATEGORY: Partial<Record<TaskKind, string>> = {
  implement: 'feature',
  debug: 'fix',
  refactor: 'refactor',
};

function kindPassRates(s: Session) {
  const rateOf = (route: RouteOption, category: string) => {
    const candidate = s.route.candidates.find((entry) => entry.provider === route.provider);
    return candidate ? measuredRate(candidate, route.model, category) : null;
  };
  return (kind: TaskKind | null, below: RouteOption, chat: RouteOption): KindPassRates | null => {
    const category = kind ? MEASURED_CATEGORY[kind] : undefined;
    if (!category) return null;
    const lower = rateOf(below, category);
    const chatRate = rateOf(chat, category);
    if (!lower || !chatRate) return null;
    return {
      below: lower.rate,
      chat: chatRate.rate,
      runs: Math.min(lower.runs, chatRate.runs),
    };
  };
}

function outcomeOf(plan: BuilderPlan): JevOutcome {
  if (plan.answers) return { answers: plan.answers, failure: null };
  return { answers: null, failure: plan.reason };
}

function providerName(s: Session, provider: string): string {
  return s.route.candidates.find((entry) => entry.provider === provider)?.name ?? provider;
}

function pickLabel(s: Session, pick: AgentPick): string {
  return `${providerName(s, pick.provider)} ${pick.modelLabel ?? pick.model ?? 'default'}`;
}

function pickNote(s: Session, route: PieceRoute, asked: boolean): string | null {
  if (!asked || route.place.placement === 'read_only') return null;
  const { model } = route;
  if (model.decidedBy === 'jev') return `Jev: ${model.reason}`;
  const overrode = model.jevPick ? ` (Jev picked ${pickLabel(s, model.jevPick)})` : '';
  return `Rules: ${pickLabel(s, model.pick)} · ${model.reason}${overrode}`;
}

function summaryOf(routed: RoutedPieces, outcome: JevOutcome): string {
  const byJev = routed.pieces.filter((piece) => piece.model.decidedBy === 'jev').length;
  const building = routed.pieces.filter((piece) => piece.place.placement !== 'read_only').length;
  if (!outcome.answers) return `Piece routes by rules (${outcome.failure ?? JEV_NOT_CONNECTED})`;
  return `Jev picked ${byJev} of ${building} piece routes; the rest by rules or floors`;
}

async function record(
  s: Session,
  routed: RoutedPieces,
  outcome: JevOutcome,
  plan: BuilderPlan,
  rules: RouteRules<CheckedPiece>,
): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'piece_route',
    childRunId: null,
    role: 'builder',
    stepIndex: null,
    jevStatus: plan.status,
    inputTokens: null,
    costUsd: null,
    policyVersion: COORD_POLICY_VERSION,
    body: {
      summary: summaryOf(routed, outcome),
      applied: routed.pieces.some((piece) => piece.model.decidedBy === 'jev') ? 'jev' : 'rules',
      gate: null,
      jevError: plan.call?.error ?? outcome.failure,
      jevModel: plan.call?.model ?? null,
      latencyMs: null,
      answer: {
        builders: plan.builders,
        groups: plan.groups,
        placement: { rules: rules.placement, applied: routed.placement },
        routes: rules.routes.map((route) => route.id),
        pieces: routed.pieces.map((piece) => ({
          key: piece.key,
          rulesPick: rules.picks.get(piece.key) ?? null,
          jevPick: piece.model.jevPick,
          pick: piece.model.pick,
          decidedBy: piece.model.decidedBy,
          reason: piece.model.reason,
          placement: piece.place,
          signals: piece.answer,
          demand: piece.model.demand ?? null,
        })),
      },
    },
  });
}

function destructive(s: Session) {
  const isDestructive = destructivePath(s);
  return (piece: CheckedPiece) => [...piece.owned.paths, ...piece.owned.globs].some(isDestructive);
}

const PLACE_WORDS: Partial<Record<PiecePlacement, string>> = {
  shared: 'shared tree',
  worktree: 'worktree',
};

function tierRank(tier: string): number {
  return (ROUTER_TIERS as readonly string[]).indexOf(tier);
}

function routeOf(
  rules: RouteRules<CheckedPiece>,
  pick: { provider: string; model: string | null },
) {
  return rules.routes.find(
    (route) => route.provider === pick.provider && route.model === pick.model,
  );
}

function belowChat(rules: RouteRules<CheckedPiece>, route: PieceRoute): boolean {
  if (route.model.decidedBy !== 'jev') return false;
  const chat = routeOf(rules, rules.route.chat);
  const picked = routeOf(rules, route.model.pick);
  return chat !== undefined && picked !== undefined && tierRank(picked.tier) < tierRank(chat.tier);
}

function builderPart(s: Session, rules: RouteRules<CheckedPiece>, route: PieceRoute): string {
  const simple = belowChat(rules, route) ? ' (clearly simple)' : '';
  const place = PLACE_WORDS[route.place.placement];
  return `${route.key} ${pickLabel(s, route.model.pick)}${simple}${place ? `, ${place}` : ''}`;
}

function builderLine(
  s: Session,
  head: string,
  routed: RoutedPieces,
  rules: RouteRules<CheckedPiece>,
): string {
  const parts = routed.pieces
    .filter((route) => route.place.placement !== 'read_only')
    .map((route) => builderPart(s, rules, route));
  return [head, ...parts].join(' · ');
}

export async function routePieces(
  s: Session,
  pieces: readonly CheckedPiece[],
  place: ListPlace,
  rulesPicks: ReadonlyMap<string, AgentPick>,
  facts: AssignFacts,
  plan: BuilderPlan,
): Promise<PiecePicks> {
  const building = pieces.filter((piece) => !piece.research);
  const fileFacts: ReadonlyMap<string, FileFacts> = plan.answers
    ? await loadFileFacts(
        s.deps.db,
        s.input.projectRoots[0]!,
        building.flatMap((piece) => [...piece.owns, ...piece.reads]),
        s.scanReport?.candidates ?? [],
      )
    : new Map();
  const rules: RouteRules<CheckedPiece> = {
    route: s.route,
    picks: rulesPicks,
    routes: offeredRoutes(s, facts),
    placement: place.placement,
    requestDestructive: s.facts.destructive,
    destructive: destructive(s),
    core: (piece) => touchesCore(piece, fileFacts),
    kindPassRates: kindPassRates(s),
  };
  const outcome = outcomeOf(plan);
  const routed = routePieceList(pieces, rules, outcome, (piece) => factPaths(piece.owns).length);
  await record(s, routed, outcome, plan, rules).catch((error: unknown) =>
    console.error('Could not record the piece routes', error),
  );
  const asked = s.jev !== null;
  const reason = plan.answers
    ? `${builderLine(s, plan.reason, routed, rules)}; ${place.reason}`
    : place.reason;
  return {
    ...routed,
    reason,
    notes: new Map(routed.pieces.map((piece) => [piece.key, pickNote(s, piece, asked)])),
  };
}
