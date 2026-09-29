import { agentLabel, nextCrewName, type AgentPick, type AgentRole } from '@spark-outpost/contracts';
import { POLICY_VERSION } from '../advisor/policy.ts';
import { whyLine } from '../model-cards/why.ts';
import { insertDecision, usedNames } from '../persistence/orchestrations.ts';
import { complexByBreadth, complexByJev, firstSignal } from './builder-complexity.ts';
import { belowFloor, floorReason, type FloorRole } from './model-floor.ts';
import {
  keepSession,
  resumableChat,
  resumableTask,
  type KeptRoute,
  type ResumableSession,
  type SessionChoice,
} from './session-keep.ts';
import {
  builderComplexity,
  DESTRUCTIVE_RULE,
  escalate,
  escalateBuilder,
  routeBuilder,
  routeCritic,
  routeMemberModel,
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
  return { ...s.facts, complex, ...(breadth.setAside ? { setAside: breadth.setAside } : {}) };
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

async function firstBuilderRoute(s: Session): Promise<ResolvedRoute> {
  const facts = builderFacts(s);
  const route = routeBuilder(s.route, facts, jevTier(s));
  if (!s.taskId) return { route };
  const session = await resumableTask(
    s.deps.db,
    s.input,
    builderKey(s.taskId),
    s.deps.sessionLimits?.idleMs,
  );
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

export async function resolveRoute(s: Session, spawn: Spawn): Promise<ResolvedRoute> {
  const previous = s.routes.get(spawn.role);
  if (previous && spawn.escalate) {
    const route =
      spawn.role === 'builder' ? escalateBuilder(s.route, previous) : escalate(s.route, previous);
    return { route };
  }
  if (previous) return { route: previous };
  if (spawn.role === 'critic') return { route: routeCritic(s.route) };
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
  if (!jev || jev.model === route.pick.model) return '';
  return ` · Jev would have used ${jev.modelLabel ?? jev.model}`;
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
        why: whyLine(route),
      },
    },
  });
}
