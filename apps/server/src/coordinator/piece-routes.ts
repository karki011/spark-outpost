import type { AgentPick, ListPlacement, PiecePlacement } from '@spark-outpost/contracts';
import type { ChoiceDistribution, ChoiceIssue } from '../advisor/choice-answer.ts';
import { selectableModels } from '../advisor/intake-questions.ts';
import { COORD_JEV_ACT_AT, ROUTE_ACCEPT_CONFIDENCE } from '../advisor/policy.ts';
import { FLOOR_REASON, floorPick } from '../orchestration/model-floor.ts';
import { builderEffort, DESTRUCTIVE_RULE, type RouteContext } from '../orchestration/routing.ts';
import { pickOf } from '../routing/candidates.ts';
import { UNCERTAIN } from '../routing/route-question.ts';
import { reaches } from './graph.ts';
import { sharedFiles, type OwnedSet } from './owned.ts';
import { OWN_WORKTREE, type PieceAnswer, type RouteOption } from './piece-questions.ts';

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
  askPlacement: boolean;
  destructive(piece: T): boolean;
  listIsolation: string | null;
  pieceIsolation(piece: T): string | null;
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
}

export interface PlaceChoice {
  placement: PiecePlacement;
  jev: string | null;
  decidedBy: Decider;
  reason: string;
}

export interface PieceRoute {
  key: string;
  model: ModelChoice;
  place: PlaceChoice;
  complexity: number | null;
  stakes: number | null;
  files: number;
}

export interface RoutedPieces {
  pieces: PieceRoute[];
  placement: ListPlacement;
}

function confidenceText(value: number): string {
  return value.toFixed(2);
}

function issueReason(issue: ChoiceIssue): string {
  return `Jev's answer was unusable (${issue})`;
}

function ratingsReason(answer: PieceAnswer, files: number): string {
  const parts = [
    ...(answer.complexity === null ? [] : [`complexity ${answer.complexity}/5`]),
    ...(answer.stakes === null ? [] : [`stakes ${answer.stakes}/5`]),
    `${files} ${files === 1 ? 'file' : 'files'}`,
  ];
  return parts.join(', ');
}

function rulesChoice<T extends RoutablePiece>(
  rules: RouteRules<T>,
  piece: T,
  reason: string,
): ModelChoice {
  return { pick: rules.picks.get(piece.key)!, jevPick: null, decidedBy: 'rules', reason };
}

function withEffort(context: RouteContext, pick: AgentPick): AgentPick {
  return { ...pick, effort: builderEffort(context, pick) };
}

function jevModel<T extends RoutablePiece>(
  rules: RouteRules<T>,
  piece: T,
  answer: PieceAnswer,
  chosen: ChoiceDistribution,
  files: number,
): ModelChoice {
  const offered = rules.routes.find((route) => route.id === chosen.choice);
  if (!offered) return rulesChoice(rules, piece, issueReason('unknown-choice'));
  const jevPick = withEffort(rules.route, pickOf(offered, null));
  const candidate = rules.route.candidates.find((entry) => entry.provider === offered.provider);
  const destructive = rules.destructive(piece);
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
    };
  }
  return { pick: jevPick, jevPick, decidedBy: 'jev', reason: ratingsReason(answer, files) };
}

function chooseModel<T extends RoutablePiece>(
  rules: RouteRules<T>,
  jev: JevOutcome,
  piece: T,
  files: number,
): ModelChoice {
  const answer = jev.answers?.get(piece.key);
  if (!answer) return rulesChoice(rules, piece, jev.failure ?? 'Jev was not asked');
  const builder = answer.builder;
  if (typeof builder === 'string') return rulesChoice(rules, piece, issueReason(builder));
  if (builder.choice === UNCERTAIN) return rulesChoice(rules, piece, 'Jev was unsure');
  if (builder.confidence < ROUTE_ACCEPT_CONFIDENCE) {
    return rulesChoice(rules, piece, `Jev was unsure (${confidenceText(builder.confidence)})`);
  }
  return jevModel(rules, piece, answer, builder, files);
}

function rulesPlace<T extends RoutablePiece>(
  rules: RouteRules<T>,
  reason: string,
  jev: string | null = null,
): PlaceChoice {
  return { placement: rules.placement, jev, decidedBy: 'rules', reason };
}

function choosePlace<T extends RoutablePiece>(
  rules: RouteRules<T>,
  answer: PieceAnswer | undefined,
  piece: T,
): PlaceChoice {
  if (piece.research) {
    return { placement: 'read_only', jev: null, decidedBy: 'rules', reason: 'reads only' };
  }
  if (!rules.askPlacement) return rulesPlace(rules, 'placement was not asked');
  const placement = answer?.placement ?? null;
  const jev = placement && typeof placement !== 'string' ? placement.choice : null;
  const hard = rules.listIsolation ?? rules.pieceIsolation(piece);
  if (hard) return { placement: 'worktree', jev, decidedBy: 'rules', reason: hard };
  if (!placement) return rulesPlace(rules, 'Jev gave no placement');
  if (typeof placement === 'string') return rulesPlace(rules, issueReason(placement));
  if (placement.confidence < COORD_JEV_ACT_AT) {
    return rulesPlace(rules, `Jev was unsure (${confidenceText(placement.confidence)})`, jev);
  }
  const own = placement.choice === OWN_WORKTREE;
  return {
    placement: own ? 'worktree' : 'shared',
    jev,
    decidedBy: 'jev',
    reason: own ? 'own worktree' : 'shared tree',
  };
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
  const routes = pieces.map((piece): PieceRoute => {
    const answer = jev.answers?.get(piece.key);
    const files = fileCount(piece);
    return {
      key: piece.key,
      model: piece.research
        ? rulesChoice(rules, piece, 'reads only')
        : chooseModel(rules, jev, piece, files),
      place: choosePlace(rules, answer, piece),
      complexity: answer?.complexity ?? null,
      stakes: answer?.stakes ?? null,
      files,
    };
  });
  if (rules.placement !== 'in_order') separateShared(pieces, routes);
  return { pieces: routes, placement: listPlacement(rules, routes) };
}
