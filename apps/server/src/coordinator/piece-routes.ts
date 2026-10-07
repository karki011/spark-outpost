import type { AgentPick, ListPlacement, PiecePlacement } from '@spark-outpost/contracts';
import { selectableModels } from '../advisor/intake-questions.ts';
import { FLOOR_REASON, floorPick } from '../orchestration/model-floor.ts';
import { builderEffort, DESTRUCTIVE_RULE, type RouteContext } from '../orchestration/routing.ts';
import { pickOf } from '../routing/candidates.ts';
import { reaches } from './graph.ts';
import { sharedFiles, type OwnedSet } from './owned.ts';
import {
  atChatTier,
  belowChatBlock,
  clearlySimple,
  pickForDemand,
  pieceDemand,
  riskyAnswer,
  type Demand,
  type KindPassRates,
  type PieceFacts,
  type RoutePick,
} from './piece-demand.ts';
import type { PieceAnswer, RouteOption, TaskKind } from './piece-questions.ts';

export type Decider = 'jev' | 'rules' | 'floor';

export interface RoutablePiece {
  key: string;
  owned: OwnedSet;
  dependsOn: readonly string[];
  research: boolean;
}

export interface RouteRules<T extends RoutablePiece = RoutablePiece> {
  route: RouteContext;
  picks: ReadonlyMap<string, AgentPick>;
  routes: readonly RouteOption[];
  placement: ListPlacement;
  requestDestructive: boolean;
  destructive(piece: T): boolean;
  core(piece: T): boolean | null;
  kindPassRates?(
    kind: TaskKind | null,
    below: RouteOption,
    chat: RouteOption,
  ): KindPassRates | null;
}

export interface JevOutcome {
  answers: ReadonlyMap<string, PieceAnswer> | null;
  failure: string | null;
}

export interface ModelChoice {
  pick: AgentPick;
  jevPick: AgentPick | null;
  decidedBy: Decider;
  reason: string;
  demand?: Demand;
}

export interface PlaceChoice {
  placement: PiecePlacement;
  decidedBy: Decider;
  reason: string;
}

export interface PieceRoute {
  key: string;
  model: ModelChoice;
  place: PlaceChoice;
  answer: PieceAnswer | null;
  files: number;
}

export interface RoutedPieces {
  pieces: PieceRoute[];
  placement: ListPlacement;
}

function rulesChoice<T extends RoutablePiece>(
  rules: RouteRules<T>,
  piece: T,
  reason: string,
  demand?: Demand,
): ModelChoice {
  return {
    pick: rules.picks.get(piece.key)!,
    jevPick: null,
    decidedBy: 'rules',
    reason,
    ...(demand ? { demand } : {}),
  };
}

function withEffort(context: RouteContext, pick: AgentPick): AgentPick {
  return { ...pick, effort: builderEffort(context, pick) };
}

function routeLabel(context: RouteContext, route: RouteOption): string {
  const provider = context.candidates.find((entry) => entry.provider === route.provider);
  return `${provider?.name ?? route.provider} ${route.label}`;
}

function tierText(demand: Demand, chosen: RoutePick): string {
  const raised = demand.raisedBy ? ` (${demand.raisedBy})` : '';
  if (chosen.route.tier === demand.tier) return `${demand.tier} tier${raised}`;
  return `demand ${demand.tier}${raised} → ${chosen.route.tier} route`;
}

function demandReason(context: RouteContext, demand: Demand, chosen: RoutePick): string {
  const signals = demand.signals ? `${demand.signals} → ` : '';
  return `${signals}${tierText(demand, chosen)} → ${routeLabel(context, chosen.route)} (${chosen.why})`;
}

function jevModel<T extends RoutablePiece>(
  rules: RouteRules<T>,
  destructive: boolean,
  demand: Demand,
  chosen: RoutePick,
): ModelChoice {
  const jevPick = withEffort(rules.route, pickOf(chosen.route, null));
  const candidate = rules.route.candidates.find(
    (entry) => entry.provider === chosen.route.provider,
  );
  const floored = floorPick(jevPick, candidate ? selectableModels(candidate) : [], {
    aim: destructive ? 'top' : 'floor',
    now: rules.route.now ?? new Date(),
  }).pick;
  if (floored.model !== jevPick.model) {
    return {
      pick: withEffort(rules.route, floored),
      jevPick,
      decidedBy: 'floor',
      reason: destructive ? DESTRUCTIVE_RULE : FLOOR_REASON,
      demand,
    };
  }
  return {
    pick: jevPick,
    jevPick,
    decidedBy: 'jev',
    reason: demandReason(rules.route, demand, chosen),
    demand,
  };
}

function chooseModel<T extends RoutablePiece>(
  rules: RouteRules<T>,
  jev: JevOutcome,
  piece: T,
  destructive: boolean,
): ModelChoice {
  const answer = jev.answers?.get(piece.key);
  if (!answer)
    return rulesChoice(rules, piece, jev.failure ?? 'Jev not asked: no answer for this piece');
  const facts = { destructive, core: rules.core(piece) };
  const result = pieceDemand(answer, facts);
  if (!result.ok) return rulesChoice(rules, piece, result.reason);
  const first = pickForDemand(result.demand, rules.routes, rules.route.chat.provider);
  const kept = first ? chatTierDemand(rules, answer, facts, result.demand, first) : null;
  const demand = kept ?? result.demand;
  const chosen = kept ? pickForDemand(kept, rules.routes, rules.route.chat.provider) : first;
  if (!chosen) {
    return rulesChoice(rules, piece, `no healthy ${demand.tier}-tier route or higher`, demand);
  }
  return jevModel(rules, destructive, demand, chosen);
}

function chatRoute<T extends RoutablePiece>(rules: RouteRules<T>): RouteOption | null {
  const { provider, model } = rules.route.chat;
  return rules.routes.find((route) => route.provider === provider && route.model === model) ?? null;
}

function chatTierDemand<T extends RoutablePiece>(
  rules: RouteRules<T>,
  answer: PieceAnswer,
  facts: PieceFacts,
  demand: Demand,
  chosen: RoutePick,
): Demand | null {
  const chat = chatRoute(rules);
  if (!chat) return null;
  const measured = rules.kindPassRates?.(demand.kind, chosen.route, chat) ?? null;
  const block = belowChatBlock(clearlySimple(answer, facts), measured);
  return atChatTier(demand, chosen, chat.tier, block);
}

function destructivePieces<T extends RoutablePiece>(
  pieces: readonly T[],
  rules: RouteRules<T>,
  jev: JevOutcome,
): Set<string> {
  const building = pieces.filter((piece) => !piece.research);
  const own = building.filter((piece) => {
    const answer = jev.answers?.get(piece.key);
    return rules.destructive(piece) || (answer !== undefined && riskyAnswer(answer));
  });
  const whole = own.length === 0 && rules.requestDestructive;
  return new Set((whole ? building : own).map((piece) => piece.key));
}

function choosePlace<T extends RoutablePiece>(rules: RouteRules<T>, piece: T): PlaceChoice {
  if (piece.research) return { placement: 'read_only', decidedBy: 'rules', reason: 'reads only' };
  return { placement: rules.placement, decidedBy: 'rules', reason: 'follows the list' };
}

function ordered(
  graph: ReadonlyMap<string, readonly string[]>,
  a: RoutablePiece,
  b: RoutablePiece,
): boolean {
  return reaches(graph, a.key, b.key) || reaches(graph, b.key, a.key);
}

function separateShared(pieces: readonly RoutablePiece[], routes: PieceRoute[]): void {
  const graph = new Map(pieces.map((piece) => [piece.key, piece.dependsOn]));
  const placed = new Map(routes.map((route) => [route.key, route]));
  const shared: RoutablePiece[] = [];
  for (const piece of pieces) {
    const route = placed.get(piece.key)!;
    if (route.place.placement !== 'shared') continue;
    const clash = shared.find(
      (other) => !ordered(graph, piece, other) && sharedFiles(piece.owned, other.owned).length > 0,
    );
    if (!clash) {
      shared.push(piece);
      continue;
    }
    route.place = {
      ...route.place,
      placement: 'worktree',
      decidedBy: 'rules',
      reason: `shares files with ${clash.key}`,
    };
  }
}

function listPlacement<T extends RoutablePiece>(
  rules: RouteRules<T>,
  routes: readonly PieceRoute[],
): ListPlacement {
  if (rules.placement === 'in_order') return 'in_order';
  const building = routes.filter((route) => route.place.placement !== 'read_only');
  if (building.length === 0) return rules.placement;
  return building.some((route) => route.place.placement === 'shared') ? 'shared' : 'worktree';
}

export function routePieceList<T extends RoutablePiece>(
  pieces: readonly T[],
  rules: RouteRules<T>,
  jev: JevOutcome,
  fileCount: (piece: T) => number,
): RoutedPieces {
  const destructive = destructivePieces(pieces, rules, jev);
  const routes = pieces.map((piece): PieceRoute => {
    const answer = jev.answers?.get(piece.key);
    return {
      key: piece.key,
      model: piece.research
        ? rulesChoice(rules, piece, 'reads only')
        : chooseModel(rules, jev, piece, destructive.has(piece.key)),
      place: choosePlace(rules, piece),
      answer: answer ?? null,
      files: fileCount(piece),
    };
  });
  if (rules.placement !== 'in_order') separateShared(pieces, routes);
  return { pieces: routes, placement: listPlacement(rules, routes) };
}
