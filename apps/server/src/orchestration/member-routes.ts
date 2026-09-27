import { agentLabel, nextCrewName, type AgentPick, type AgentRole } from '@spark-outpost/contracts';
import { cardCategoryFor } from '../model-cards/categories.ts';
import { frontierRecord, tierSourceOf, whyLine } from '../model-cards/why.ts';
import { insertDecision, usedNames } from '../persistence/orchestrations.ts';
import { namedFiles } from './context.ts';
import { plansFirst, reviewWanted } from './depth.ts';
import { callJev, type JevCall } from './jev-calls.ts';
import { buildRouteQuestions, parseRouteAnswers, type RouteSlot } from './jev-questions.ts';
import { planShape, routeArchitect } from './architect-route.ts';
import {
  KEPT_FOR_SESSION,
  keepSession,
  resumableChat,
  type SessionChoice,
} from './session-keep.ts';
import {
  criticProvider,
  escalate,
  intakePickFor,
  pickFromRoute,
  routeCritic,
  routeWorker,
  type JevPick,
  type MemberRoute,
} from './routing.ts';
import { routeKey, type Session } from './session.ts';
import { builderSpans } from './spans.ts';
import type { Spawn } from './transitions.ts';

const ARCHITECT_WORK = 'Read the code and write the step-by-step plan; no edits.';

function slotFor(
  s: Session,
  role: AgentRole,
  stepIndex: number,
  span: readonly number[] = [stepIndex],
): RouteSlot | null {
  const provider = role === 'critic' ? criticProvider(s.route) : s.route.chat.provider;
  const candidate = s.route.candidates.find((option) => option.provider === provider);
  if (!candidate) return null;
  const step =
    role === 'builder'
      ? span.map((index) => s.flow.steps[index] ?? '').join('\n')
      : role === 'architect'
        ? ARCHITECT_WORK
        : null;
  const jev = s.intake.body.jev;
  const intent =
    jev && jev.confidences.intent !== undefined && jev.confidences.intent >= 0.5
      ? jev.intent
      : null;
  return {
    key: routeKey(role, stepIndex).replace(':', '_'),
    role,
    step: step || null,
    candidate,
    category: cardCategoryFor(role, intent, s.route.risk),
  };
}

async function askRoutes(s: Session, slots: readonly RouteSlot[]): Promise<JevCall | null> {
  if (slots.length === 0 || !s.jev) return null;
  const call = await callJev(
    s.jev,
    () => buildRouteQuestions(s.input.userRequest, slots),
    s.control.signal,
  );
  if (call.status !== 'answered' || !call.response) return call;
  try {
    const picks = parseRouteAnswers(slots, call.response);
    for (const slot of slots) {
      const pick = picks.get(slot.key);
      const [role, step] = slot.key.split('_') as [AgentRole, string];
      s.planned.set(
        routeKey(role, Number(step)),
        pick ? pickFromRoute(slot.candidate.provider, slot.candidate, pick) : null,
      );
    }
    return call;
  } catch (error) {
    return { ...call, status: 'failed', error: (error as Error).message };
  }
}

async function planRoutes(s: Session): Promise<JevCall | null> {
  if (s.plannedCalled) return null;
  s.plannedCalled = true;
  const groups = s.flow.worktrees ? s.flow.groups : [];
  const slots = builderSpans(s.flow.steps, groups).flatMap(
    (span) => slotFor(s, 'builder', span[0]!, span) ?? [],
  );
  if (reviewWanted(s.flow)) {
    const critic = slotFor(s, 'critic', 0);
    if (critic) slots.push(critic);
  }
  return askRoutes(s, slots);
}

async function jevPickFor(
  s: Session,
  spawn: Spawn,
): Promise<{ jev: JevPick | null; call: JevCall | null }> {
  const key = routeKey(spawn.role, spawn.stepIndex);
  if (
    spawn.role === 'scout' ||
    (spawn.role === 'builder' && !plansFirst(s.flow.depth) && spawn.stepIndex === 0)
  ) {
    const response = s.intake.outcome.status === 'answered' ? s.intake.outcome.response : null;
    return { jev: intakePickFor(s.route, s.route.chat.provider, response), call: null };
  }
  let call: JevCall | null = null;
  if (spawn.role === 'builder' && plansFirst(s.flow.depth)) call = await planRoutes(s);
  if (spawn.role === 'critic' && !s.planned.has(key)) {
    const slot = slotFor(s, 'critic', 0);
    call = slot ? await askRoutes(s, [slot]) : null;
  }
  return { jev: s.planned.get(key) ?? null, call };
}

export interface ResolvedRoute {
  route: MemberRoute;
  summary: string;
  call: JevCall | null;
  fresh: boolean;
  rulePick?: AgentPick;
  session?: SessionChoice;
}

async function architectRoute(s: Session): Promise<ResolvedRoute> {
  const slot = slotFor(s, 'architect', 0);
  const call = slot ? await askRoutes(s, [slot]) : null;
  const jev = s.planned.get(routeKey('architect', 0)) ?? null;
  const shape = planShape(namedFiles([s.input.userRequest]).length, s.intake.body.jev);
  const route = routeArchitect(s.route, shape, jev);
  return { route, summary: route.rule, call, fresh: true, rulePick: route.rulePick };
}

export async function resolveRoute(s: Session, spawn: Spawn): Promise<ResolvedRoute> {
  const key = routeKey(spawn.role, spawn.stepIndex);
  const previous = s.routes.get(key);
  if (previous && spawn.escalate) {
    const route = escalate(s.route, previous);
    return { route, summary: 'one tier up', call: null, fresh: false };
  }
  if (previous && spawn.reason !== 'first') {
    return { route: previous, summary: spawn.reason, call: null, fresh: false };
  }
  if (spawn.role === 'architect') return architectRoute(s);
  const { jev, call } = await jevPickFor(s, spawn);
  const route = spawn.role === 'critic' ? routeCritic(s.route, jev) : routeWorker(s.route, jev);
  if (!runsInPlace(s, spawn)) return { route, summary: route.routedBy, call, fresh: true };
  const mode = spawn.role === 'scout' && s.input.mode === 'do' ? 'ask' : s.input.mode;
  const session = await resumableChat(s.deps.db, s.input, mode, s.deps.sessionLimits?.idleMs);
  const kept = keepSession(route, session);
  const summary = kept.choice?.kept ? KEPT_FOR_SESSION : kept.route.routedBy;
  return {
    route: kept.route,
    summary,
    call,
    fresh: true,
    ...(kept.choice ? { session: kept.choice } : {}),
  };
}

function runsInPlace(s: Session, spawn: Spawn): boolean {
  if (s.inPlaceUsed || spawn.reason !== 'first' || spawn.stepIndex !== 0) return false;
  return spawn.role === 'scout' || (spawn.role === 'builder' && !plansFirst(s.flow.depth));
}

export async function nameFor(s: Session, role: AgentRole, key: string): Promise<string> {
  const known = s.names.get(key);
  if (known) return known;
  const stored = s.taskId ? await usedNames(s.deps.db, s.taskId, role) : [];
  const own = [...s.names].filter(([owner]) => owner.startsWith(`${role}:`)).map(([, n]) => n);
  const name = nextCrewName(role, [...stored, ...own]);
  s.names.set(key, name);
  return name;
}

export function labelFor(role: AgentRole, pick: AgentPick, name: string): string {
  return agentLabel(role, pick.modelLabel ?? pick.model, pick.effort, name);
}

export async function recordRoute(
  s: Session,
  spawn: Spawn,
  resolved: ResolvedRoute,
  childRunId: string,
  name: string,
): Promise<void> {
  const { route, call } = resolved;
  const applied =
    route.routedBy === 'jev' ? 'jev' : route.routedBy === 'pinned' ? 'pinned' : 'rules';
  const label = labelFor(spawn.role, route.pick, name);
  const why = {
    pick: route.pick,
    routedBy: route.routedBy,
    jevPick: route.autoWouldUse,
    gate: route.gate,
    rule: resolved.summary,
    candidate: s.route.candidates.find(
      (candidate) => candidate.provider === (route.autoWouldUse ?? route.pick).provider,
    ),
  };
  const frontier = frontierRecord(why);
  const wouldUse = route.autoWouldUse
    ? ` · Auto would have used ${route.autoWouldUse.modelLabel ?? route.autoWouldUse.model} · ${route.autoWouldUse.effort}`
    : '';
  const sessionNote = resolved.session ? ` · ${resolved.session.reason}` : '';
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'route',
    childRunId,
    role: spawn.role,
    stepIndex: spawn.stepIndex,
    jevStatus: call?.status ?? (s.jev ? 'not_asked' : 'not_connected'),
    inputTokens: call?.usage?.inputTokens ?? null,
    costUsd: call?.usage?.costUsd ?? null,
    body: {
      summary: `${label}${wouldUse}${sessionNote}`,
      applied,
      gate: route.gate,
      jevError: call?.error ?? null,
      latencyMs: call?.latencyMs ?? null,
      answer: {
        pick: route.pick,
        routedBy: route.routedBy,
        autoWouldUse: route.autoWouldUse,
        reason: spawn.reason,
        escalated: spawn.escalate,
        rule: resolved.summary,
        ...(resolved.rulePick ? { rulePick: resolved.rulePick } : {}),
        ...(resolved.session ? { session: resolved.session } : {}),
        why: whyLine(why),
        tierSource: tierSourceOf(route.pick),
        ...(frontier ? { frontier } : {}),
      },
      state: call?.asked?.state ?? null,
      questions: call?.asked?.questions ?? null,
      answers: call?.response?.answers ?? null,
    },
  });
}
