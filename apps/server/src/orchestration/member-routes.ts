import { agentLabel, nextCrewName, type AgentPick, type AgentRole } from '@spark-outpost/contracts';
import { POLICY_VERSION } from '../advisor/policy.ts';
import { whyLine } from '../model-cards/why.ts';
import { insertDecision, usedNames } from '../persistence/orchestrations.ts';
import { keepSession, resumableChat, resumableTask, type SessionChoice } from './session-keep.ts';
import {
  escalate,
  routeBuilder,
  routeCritic,
  routeMemberModel,
  type MemberRoute,
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

async function firstBuilderRoute(s: Session): Promise<ResolvedRoute> {
  const route = routeBuilder(s.route, s.facts, jevTier(s));
  if (!s.taskId) return { route };
  const session = await resumableTask(
    s.deps.db,
    s.input,
    builderKey(s.taskId),
    s.deps.sessionLimits?.idleMs,
  );
  const kept = keepSession(route, session, s.facts.destructive);
  return { route: kept.route, ...(kept.choice ? { session: kept.choice } : {}) };
}

async function scoutRoute(s: Session): Promise<ResolvedRoute> {
  const route = routeMemberModel(s.route, { trivial: false, destructive: false }, jevTier(s));
  const mode = s.input.mode === 'do' ? 'ask' : (s.input.mode ?? 'chat');
  const session = await resumableChat(s.deps.db, s.input, mode, s.deps.sessionLimits?.idleMs);
  const kept = keepSession(route, session);
  return { route: kept.route, ...(kept.choice ? { session: kept.choice } : {}) };
}

export async function resolveRoute(s: Session, spawn: Spawn): Promise<ResolvedRoute> {
  const previous = s.routes.get(spawn.role);
  if (previous && spawn.escalate) return { route: escalate(s.route, previous) };
  if (previous) return { route: previous };
  if (spawn.role === 'critic') return { route: routeCritic(s.route) };
  if (spawn.role === 'scout') return scoutRoute(s);
  return firstBuilderRoute(s);
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
      summary: `${label} · ${route.rule}${jevLine(route)}${sessionNote}`,
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
        jevTier: jev?.tier ?? null,
        jevTierConfidence: jev?.routeConfidence ?? null,
        ...(resolved.session ? { session: resolved.session } : {}),
        why: whyLine(route),
      },
    },
  });
}
