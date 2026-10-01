import type { AgentPick, JevStatus } from '@spark-outpost/contracts';
import type { AdvisorOption } from '../advisor/advice.ts';
import { selectableModels } from '../advisor/intake-questions.ts';
import { COORD_POLICY_VERSION, ROUTE_TOKEN_MIX } from '../advisor/policy.ts';
import { cardFor } from '../model-cards/cards.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { callJev, type JevCall } from '../orchestration/jev-calls.ts';
import { builderModels } from '../orchestration/model-floor.ts';
import type { Session } from '../orchestration/session.ts';
import { destructiveTargets } from '../orchestration/risk-rules.ts';
import { routeCandidates } from '../routing/candidates.ts';
import { placementFacts } from './assess.ts';
import { measuredRate, measuredStrength, type AssignFacts } from './assign.ts';
import type { KindPassRates } from './piece-demand.ts';
import type { ListPlace } from './place-list.ts';
import { inMigrationsFolder, listIsolation, pieceIsolation } from './placement.ts';
import { factPaths, loadFileFacts, type FileFacts } from './piece-facts.ts';
import {
  pieceQuestions,
  readPieceAnswers,
  touchesCore,
  type PieceAsk,
  type RouteOption,
  type TaskKind,
} from './piece-questions.ts';
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

function jevFailure(call: JevCall): string | null {
  if (call.status === 'timed_out') return 'Jev timed out';
  if (call.status === 'failed') return `Jev failed: ${call.error ?? 'unknown error'}`;
  return null;
}

export const JEV_NOT_CONNECTED = 'Jev not connected';

function outcomeOf(call: JevCall | null, ask: PieceAsk, skipped: string | null): JevOutcome {
  if (!call) return { answers: null, failure: skipped ?? JEV_NOT_CONNECTED };
  if (call.status !== 'answered' || !call.response) {
    return { answers: null, failure: jevFailure(call) };
  }
  return { answers: readPieceAnswers(call.response, ask), failure: null };
}

function providerName(s: Session, provider: string): string {
  return s.route.candidates.find((entry) => entry.provider === provider)?.name ?? provider;
}

function pickLabel(s: Session, pick: AgentPick): string {
  return `${providerName(s, pick.provider)} ${pick.modelLabel ?? pick.model ?? 'default'}`;
}

function pickNote(s: Session, route: PieceRoute, asked: boolean): string | null {
  if (!asked || route.place.placement === 'read_only') return null;
  const { model, place } = route;
  const placed = place.decidedBy === 'jev' ? ` · ${place.reason}` : '';
  if (model.decidedBy === 'jev') return `Jev: ${model.reason}${placed}`;
  const overrode = model.jevPick ? ` (Jev picked ${pickLabel(s, model.jevPick)})` : '';
  return `Rules: ${pickLabel(s, model.pick)} · ${model.reason}${overrode}${placed}`;
}

function skipReason(s: Session, building: number, routes: readonly RouteOption[]): string | null {
  if (!s.jev) return null;
  if (building === 0) return 'Jev not asked: no pieces build';
  if (routes.length === 0) return 'Jev not asked: no eligible Builder routes';
  return null;
}

function statusOf(s: Session, call: JevCall | null): JevStatus {
  if (call) return call.status;
  return s.jev ? 'not_asked' : 'not_connected';
}

function summaryOf(routed: RoutedPieces, outcome: JevOutcome, call: JevCall | null): string {
  const byJev = routed.pieces.filter((piece) => piece.model.decidedBy === 'jev').length;
  const building = routed.pieces.filter((piece) => piece.place.placement !== 'read_only').length;
  if (!call || !outcome.answers) {
    return `Piece routes by rules (${outcome.failure ?? JEV_NOT_CONNECTED})`;
  }
  return `Jev picked ${byJev} of ${building} piece routes; the rest by rules or floors`;
}

async function record(
  s: Session,
  routed: RoutedPieces,
  outcome: JevOutcome,
  call: JevCall | null,
  rules: RouteRules<CheckedPiece>,
): Promise<void> {
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'piece_route',
    childRunId: null,
    role: 'builder',
    stepIndex: null,
    jevStatus: statusOf(s, call),
    inputTokens: call?.usage?.inputTokens ?? null,
    costUsd: call?.usage?.costUsd ?? null,
    policyVersion: COORD_POLICY_VERSION,
    body: {
      summary: summaryOf(routed, outcome, call),
      applied: routed.pieces.some((piece) => piece.model.decidedBy === 'jev') ? 'jev' : 'rules',
      gate: null,
      jevError: call?.error ?? outcome.failure,
      jevModel: call?.model ?? null,
      latencyMs: call?.latencyMs ?? null,
      answer: {
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
      state: call?.asked?.state ?? null,
      questions: call?.asked ? Object.keys(call.asked.questions) : null,
      answers: call?.response?.answers ?? null,
    },
  });
}

function destructive(s: Session) {
  const targets = new Set(destructiveTargets(s.input.userRequest));
  return (piece: CheckedPiece) =>
    [...piece.owned.paths, ...piece.owned.globs].some(
      (path) => inMigrationsFolder(path) || targets.has(path),
    );
}

export async function routePieces(
  s: Session,
  pieces: readonly CheckedPiece[],
  place: ListPlace,
  rulesPicks: ReadonlyMap<string, AgentPick>,
  facts: AssignFacts,
): Promise<PiecePicks> {
  const placeFacts = await placementFacts(s);
  const routes = offeredRoutes(s, facts);
  const isDestructive = destructive(s);
  let fileFacts: ReadonlyMap<string, FileFacts> = new Map();
  const rules: RouteRules<CheckedPiece> = {
    route: s.route,
    picks: rulesPicks,
    routes,
    placement: place.placement,
    askPlacement: place.placement !== 'in_order' && !s.deps.forcedPlacement,
    requestDestructive: s.facts.destructive,
    destructive: isDestructive,
    core: (piece) => touchesCore(piece, fileFacts),
    listIsolation: listIsolation(pieces, placeFacts),
    pieceIsolation: (piece) => pieceIsolation(piece, placeFacts),
    kindPassRates: kindPassRates(s),
  };
  const building = pieces.filter((piece) => !piece.research);
  const skipped = skipReason(s, building.length, routes);
  const root = s.input.projectRoots[0]!;
  const ask: PieceAsk = {
    request: s.input.userRequest,
    pieces: building,
    facts: new Map(),
    placement: rules.askPlacement,
  };
  let call: JevCall | null = null;
  if (s.jev && !skipped) {
    const paths = building.flatMap((piece) => [...piece.owns, ...piece.reads]);
    fileFacts = await loadFileFacts(s.deps.db, root, paths, s.scanReport?.candidates ?? []);
    ask.facts = fileFacts;
    call = await callJev(s.jev, () => pieceQuestions(ask), s.control.signal);
  }
  const outcome = outcomeOf(call, ask, skipped);
  const routed = routePieceList(pieces, rules, outcome, (piece) => factPaths(piece.owns).length);
  await record(s, routed, outcome, call, rules).catch((error: unknown) =>
    console.error('Could not record the piece routes', error),
  );
  const asked = s.jev !== null;
  const moved = routed.pieces.filter(
    (piece) => piece.place.decidedBy === 'jev' && piece.place.placement !== place.placement,
  );
  const reason =
    moved.length > 0
      ? `${place.reason}; Jev moved ${moved.map((piece) => piece.key).join(', ')}`
      : place.reason;
  return {
    ...routed,
    reason,
    notes: new Map(routed.pieces.map((piece) => [piece.key, pickNote(s, piece, asked)])),
  };
}
