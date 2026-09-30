import { agentLabel, nextCrewName, type AgentPick, type AgentRole } from '@spark-outpost/contracts';
import { POLICY_VERSION } from '../advisor/policy.ts';
import { jevLabel, samePickModel, whyLine } from '../model-cards/why.ts';
import { insertDecision, usedNames } from '../persistence/orchestrations.ts';
import { complexByBreadth, complexByJev, firstSignal } from './builder-complexity.ts';
import type { ResumableSession, SessionChoice } from './cache-switch.ts';
import { belowFloor, floorReason, type FloorRole } from './model-floor.ts';
import { SCORED_MODELS, scoreText } from './route-score.ts';
import { keepSession, resumableChat, resumableTask, type KeptRoute } from './session-keep.ts';
import {
  builderComplexity,
  DESTRUCTIVE_RULE,
  escalate,
  escalateBuilder,
  routeBuilder,
  routeCritic,
  routeMemberModel,
  soloRoute,
  type BuiltShare,
  type MemberRoute,
  type RouteFacts,
} from './routing.ts';
import { builderKey, type Session } from './session.ts';
import type { Spawn } from './transitions.ts';

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

async function firstBuilderRoute(s: Session): Promise<ResolvedRoute> {
  const facts = builderFacts(s);
  if (s.flow.solo) return { route: soloRoute(s.route) };
  const session = s.taskId
    ? await resumableTask(s.deps.db, s.input, builderKey(s.taskId), s.deps.sessionLimits?.idleMs)
    : null;
  const route = routeBuilder(s.route, { ...facts, session }, jevTier(s));
  if (route.score) return resolvedFrom(route);
  const kept = keepBuilderSession(route, session, topReason(route, facts, s));
  return { route: kept.route, ...(kept.choice ? { session: kept.choice } : {}) };
}

async function scoutRoute(s: Session): Promise<ResolvedRoute> {
  const route = routeMemberModel(s.route, { trivial: false, destructive: false }, jevTier(s));
  const mode = s.input.mode === 'do' ? 'ask' : (s.input.mode ?? 'chat');
  const session = await resumableChat(s.deps.db, s.input, mode, s.deps.sessionLimits?.idleMs);
  const kept = keepScoutSession(route, session);
  return { route: kept.route, ...(kept.choice ? { session: kept.choice } : {}) };
}

function builtShares(s: Session): BuiltShare[] {
  const pieces = s.coordination?.list?.pieces ?? [];
  return pieces
    .filter((piece) => piece.status === 'landed' && !piece.research && piece.provider)
    .map((piece) => ({ provider: piece.provider!, files: piece.filesChanged.length }));
}

export function seatRoute(s: Session, spawn: Spawn): ResolvedRoute {
  const previous = s.routes.get('builder');
  if (previous && spawn.escalate) return { route: escalateBuilder(s.route, previous) };
  if (previous) return { route: previous };
  return { route: routeBuilder(s.route, builderFacts(s), jevTier(s)) };
}

export async function resolveRoute(s: Session, spawn: Spawn): Promise<ResolvedRoute> {
  const previous = s.routes.get(spawn.role);
  if (previous && spawn.escalate) {
    const route =
      spawn.role === 'builder' ? escalateBuilder(s.route, previous) : escalate(s.route, previous);
    return { route };
  }
  if (previous) return { route: previous };
  if (spawn.role === 'critic') return { route: routeCritic(s.route, builtShares(s)) };
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
      applied: route.routedBy === 'pinned' ? 'pinned' : 'rules',
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
