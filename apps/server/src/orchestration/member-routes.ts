import { agentLabel, nextCrewName, type AgentPick, type AgentRole } from '@spark-outpost/contracts';
import { POLICY_VERSION } from '../advisor/policy.ts';
import type { Queryable } from '../persistence/db.ts';
import { jevLabel, samePickModel, whyLine } from '../model-cards/why.ts';
import { insertDecision, usedNames } from '../persistence/orchestrations.ts';
import { complexByBreadth, complexByJev, firstSignal } from './builder-complexity.ts';
import type { ResumableSession, SessionChoice } from './cache-switch.ts';
import { ESCALATED_KINDS, type EscalationKind, type PriorEscalation } from './escalation.ts';
import { handbackNote } from './handoff.ts';
import { belowFloor, floorReason, type FloorRole } from './model-floor.ts';
import { SCORED_MODELS, scoreText } from './route-score.ts';
import { keepSession, resumableConversation, type KeptRoute } from './session-keep.ts';
import {
  builderComplexity,
  DESTRUCTIVE_RULE,
  escalate,
  escalateBuilder,
  routeBuilder,
  rereviewCritic,
  routeCritic,
  mainSessionRoute,
  smallDiffCritic,
  soloRoute,
  type MemberRoute,
  type RouteFacts,
} from './routing.ts';
import { withAccessNote } from './access-note.ts';
import type { BuiltShare } from './critic-provider.ts';
import { type Session } from './session.ts';
import { demotionsFor } from '../laws/demotion-history.ts';
import { demotedRates, withDemotion } from '../laws/demotion-route.ts';
import { taskKind } from '../laws/task-kind.ts';
import type { Spawn } from './transitions.ts';
import { escalatedHighStakes, smallReviewDiff } from './critic-rule.ts';
import { stakesFiles } from './critic-recheck.ts';
import { changesForReview } from './member-prompts.ts';

export interface ResolvedRoute {
  route: MemberRoute;
  session?: SessionChoice;
}

function jevTier(s: Session) {
  return s.intake.body.jev?.tier ?? null;
}

export function builderFacts(s: Session): RouteFacts {
  const jev = s.intake.body.jev;
  const breadth = complexByBreadth(s.scanReport, s.input.userRequest, jev);
  const complex = firstSignal(breadth.complex, complexByJev(jev));
  return {
    ...s.facts,
    complex,
    ratings: jev?.ratings ?? null,
    ...(breadth.setAside ? { setAside: breadth.setAside } : {}),
  };
}

function topReason(route: MemberRoute, facts: RouteFacts, s: Session): string | null {
  if (facts.destructive) return 'destructive work needs the top tier';
  if (route.rule === DESTRUCTIVE_RULE) return null;
  const complex = builderComplexity(s.route, facts);
  return complex ? `complex work (${complex.reason}) needs the top tier` : null;
}

function floorKept(route: MemberRoute, kept: KeptRoute, role: FloorRole): KeptRoute {
  if (!kept.choice?.kept || !belowFloor(kept.choice.session)) return kept;
  const { session } = kept.choice;
  return { route, choice: { kept: false, reason: floorReason(session, role), session } };
}

export function keepBuilderSession(
  route: MemberRoute,
  session: ResumableSession | null,
  needsTop: string | null,
): KeptRoute {
  return floorKept(route, keepSession(route, session, needsTop ?? false), 'builder');
}

export function keepScoutSession(route: MemberRoute, session: ResumableSession | null): KeptRoute {
  return floorKept(route, keepSession(route, session), 'reader');
}

function resolvedFrom(route: MemberRoute): ResolvedRoute {
  const { sessionChoice, ...rest } = route;
  return { route: rest, ...(sessionChoice ? { session: sessionChoice } : {}) };
}

interface EscalationRow {
  escalation: { kind: EscalationKind; model: string; modelLabel: string | null } | null;
}

export async function priorEscalation(
  db: Queryable,
  taskId: string,
): Promise<PriorEscalation | null> {
  const { rows } = await db.query<EscalationRow>(
    `SELECT route->'escalation' AS escalation FROM runs
     WHERE task_id = $1 AND role = 'builder' AND parent_run_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 50`,
    [taskId],
  );
  const index = rows.findIndex((row) => row.escalation && ESCALATED_KINDS.has(row.escalation.kind));
  const found = rows[index]?.escalation;
  if (!found) return null;
  return { ...found, unseen: index === 0 };
}

function withHandback(
  s: Session,
  route: MemberRoute,
  session: ResumableSession | null,
  prior: PriorEscalation | null,
): MemberRoute {
  if (!session || prior?.kind !== 'brief' || !prior.unseen) return route;
  if (route.pick.model !== session.pick.model) return route;
  return { ...route, handback: handbackNote(prior.modelLabel ?? prior.model, s.input.history) };
}

async function firstBuilderRoute(s: Session): Promise<ResolvedRoute> {
  const facts = builderFacts(s);
  if (s.flow.solo) return { route: soloRoute(s.route) };
  const session = await resumableConversation(s.deps.db, s.input);
  const prior = s.taskId ? await priorEscalation(s.deps.db, s.taskId) : null;
  const demotions = await demotionsFor(s.deps.db, s.input.workspaceId, taskKind(s)).catch(() => []);
  const demoted = demotedRates(demotions, s.route.chat.provider);
  const routed = routeBuilder(s.route, { ...facts, session, prior, demoted }, jevTier(s));
  const route = withDemotion(routed, demotions, s.route.chat.model);
  if (route.score) return resolvedFrom(withHandback(s, route, session, prior));
  const kept = keepBuilderSession(route, session, topReason(route, facts, s));
  return { route: kept.route, ...(kept.choice ? { session: kept.choice } : {}) };
}

async function scoutRoute(s: Session): Promise<ResolvedRoute> {
  const route = mainSessionRoute(s.route, jevTier(s));
  const session = await resumableConversation(s.deps.db, s.input);
  const kept = keepScoutSession(route, session);
  return { route: kept.route, ...(kept.choice ? { session: kept.choice } : {}) };
}

function builtShares(s: Session): BuiltShare[] {
  const pieces = s.coordination?.list?.pieces ?? [];
  return pieces
    .filter((piece) => piece.status === 'landed' && !piece.research && piece.provider)
    .map((piece) => ({ provider: piece.provider!, files: piece.filesChanged.length }));
}

async function firstCriticRoute(s: Session): Promise<MemberRoute> {
  const route = routeCritic(s.route, builtShares(s));
  if (s.facts.destructive || escalatedHighStakes(s.routes.get('builder'))) return route;
  const changes = await changesForReview(s).catch(() => null);
  if (!changes || !smallReviewDiff(changes.files, stakesFiles(s.coordination))) return route;
  return smallDiffCritic(s.route, route);
}

export function seatRoute(s: Session, spawn: Spawn): ResolvedRoute {
  if (spawn.role === 'coordinator') return { route: mainSessionRoute(s.route, jevTier(s)) };
  const previous = s.routes.get('builder');
  if (previous && spawn.escalate) return { route: escalateBuilder(s.route, previous) };
  if (previous) return { route: previous };
  return { route: routeBuilder(s.route, builderFacts(s), jevTier(s)) };
}

export function retryCriticProvider(
  failed: string,
  own: string,
  candidates: readonly string[],
): string {
  if (failed !== own) return own;
  return candidates.find((provider) => provider !== failed) ?? failed;
}

function retryCriticRoute(s: Session, previous: MemberRoute): MemberRoute {
  const failed = previous.pick.provider;
  const next = retryCriticProvider(
    failed,
    s.route.chat.provider,
    s.route.candidates.map((candidate) => candidate.provider),
  );
  if (next === failed) return previous;
  const name = s.route.candidates.find((candidate) => candidate.provider === failed)?.name;
  return { ...routeCritic(s.route, [], next), note: criticFallbackNote(name ?? failed) };
}

function criticFallbackNote(failedName: string): string {
  return `reviewing instead of ${failedName}, whose review did not finish`;
}

export async function resolveRoute(s: Session, spawn: Spawn): Promise<ResolvedRoute> {
  const resolved = await routeFor(s, spawn);
  return { ...resolved, route: withAccessNote(s.route, resolved.route) };
}

async function routeFor(s: Session, spawn: Spawn): Promise<ResolvedRoute> {
  const previous = s.routes.get(spawn.role);
  if (previous && spawn.role === 'critic' && spawn.reason === 'retry') {
    return { route: retryCriticRoute(s, previous) };
  }
  if (previous && spawn.escalate) {
    const route =
      spawn.role === 'builder' ? escalateBuilder(s.route, previous) : escalate(s.route, previous);
    return { route };
  }
  if (previous && spawn.role === 'critic' && s.flow.review.fixing) {
    return { route: rereviewCritic(s.route, previous) };
  }
  if (previous) return { route: previous };
  if (spawn.role === 'critic') return { route: await firstCriticRoute(s) };
  if (spawn.role === 'scout') return scoutRoute(s);
  return firstBuilderRoute(s);
}

export function escalatedBuilderPick(s: Session): AgentPick | null {
  const previous = s.routes.get('builder');
  return previous ? escalateBuilder(s.route, previous).pick : null;
}

export async function nameFor(s: Session, role: AgentRole): Promise<string> {
  const stored = s.taskId ? await usedNames(s.deps.db, s.taskId, role) : [];
  const known = s.results.find((result) => result.role === role)?.name ?? stored[0];
  return known ?? nextCrewName(role, stored);
}

export function labelFor(role: AgentRole, pick: AgentPick, name: string): string {
  return agentLabel(role, pick.modelLabel ?? pick.model, pick.effort, name);
}

function jevLine(route: MemberRoute): string {
  const jev = route.autoWouldUse;
  if (!jev || samePickModel(jev, route.pick)) return '';
  return ` · Jev would have used ${jevLabel(jev, route.pick)}`;
}

function appliedBy(route: MemberRoute): 'pinned' | 'jev' | 'rules' {
  if (route.routedBy === 'pinned' || route.routedBy === 'jev') return route.routedBy;
  return 'rules';
}

export async function recordRoute(
  s: Session,
  role: AgentRole,
  resolved: ResolvedRoute,
  childRunId: string,
  name: string,
): Promise<void> {
  const { route } = resolved;
  const label = labelFor(role, route.pick, name);
  const sessionNote = resolved.session ? ` · ${resolved.session.reason}` : '';
  const floorNote = route.note ? ` · ${route.note}` : '';
  const jev = s.intake.body.jev;
  const score = route.score;
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'route',
    childRunId,
    role,
    stepIndex: 0,
    jevStatus: s.jev ? 'not_asked' : 'not_connected',
    inputTokens: null,
    costUsd: null,
    policyVersion: POLICY_VERSION,
    body: {
      summary: `${label} · ${route.rule}${floorNote}${jevLine(route)}${sessionNote}`,
      applied: appliedBy(route),
      gate: null,
      jevError: null,
      jevModel: s.intake.body.jevModel,
      latencyMs: null,
      answer: {
        pick: route.pick,
        routedBy: route.routedBy,
        autoWouldUse: route.autoWouldUse,
        rule: route.rule,
        ...(route.note ? { note: route.note } : {}),
        jevTier: jev?.tier ?? null,
        jevTierConfidence: jev?.routeConfidence ?? null,
        ...(resolved.session ? { session: resolved.session } : {}),
        ...(route.escalation ? { escalation: route.escalation } : {}),
        ...(score
          ? {
              signals: score.signals,
              repairUsd: score.repairUsd,
              scores: score.ranked.slice(0, SCORED_MODELS),
            }
          : {}),
        why: whyLine({
          ...route,
          ...(resolved.session ? { sessionNote: resolved.session.reason } : {}),
          ...(score ? { scoreNote: scoreText(score) } : {}),
        }),
      },
    },
  });
}
