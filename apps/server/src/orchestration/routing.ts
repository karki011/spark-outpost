import type {
  AgentPick,
  ModelRef,
  ModelRouting,
  Ratings,
  RouteSource,
  RouteTier,
} from '@spark-outpost/contracts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { CRITIC_REREVIEW_EFFORT, CRITIC_SMALL_DIFF_EFFORT } from '../advisor/policy.ts';
import { selectableModels, tierOptions } from '../advisor/intake-questions.ts';
import { cardFor, TIER_RANK } from '../model-cards/cards.ts';
import { firstReportedEffort } from '../providers/efforts.ts';
import { complexByRequest, firstSignal, type ComplexSignal } from './builder-complexity.ts';
import { keptText, leftText, type ResumableSession, type SessionChoice } from './cache-switch.ts';
import {
  belowFloor,
  builderModels,
  floorModel,
  floorPick,
  floorReason,
  floorText,
  harnessModels,
  retiringNote,
  type FloorRole,
  type FlooredPick,
} from './model-floor.ts';
import {
  escalationChoice,
  escalationRule,
  scoreEscalation,
  stayedRule,
  type Escalation,
  type MeasuredArm,
  type PriorEscalation,
} from './escalation.ts';
import type { RouteScore } from './route-score.ts';
import { criticProvider, type BuiltShare } from './critic-provider.ts';
import { KEPT_FOR_SESSION } from './session-keep.ts';
import { jevRated, pinnedRule, pinnedStep, taskClearlySimple } from './pinned-builder.ts';
import { signalText, taskSignals, type TaskSignals } from './task-signals.ts';
import {
  escalatedEffort,
  highEffort,
  loweredEffort,
  modelTier,
  oneTierUp,
  strongerEffort,
  tierLadder,
  topTier,
} from './tiers.ts';

export interface RouteContext {
  routing: ModelRouting;
  chat: AgentPick;
  providerEffort: string | null;
  mainModel?: string | null;
  candidates: readonly AdvisorCandidate[];
  leftOut?: Readonly<Record<string, readonly ModelRef[]>>;
  request?: string;
  now?: Date;
}

export interface MemberRoute {
  pick: AgentPick;
  routedBy: RouteSource;
  rule: string;
  autoWouldUse: AgentPick | null;
  note?: string;
  score?: RouteScore;
  sessionChoice?: SessionChoice;
  escalation?: Escalation;
  handback?: string;
}

export interface RouteFacts {
  trivial: boolean;
  destructive: boolean;
  complex?: ComplexSignal | null;
  setAside?: string;
  vague?: boolean;
  continues?: boolean | null;
  ratings?: Ratings | null;
  session?: ResumableSession | null;
  prior?: PriorEscalation | null;
  arm?: MeasuredArm | null;
  demoted?: ReadonlyMap<string, number> | null;
}

export const DESTRUCTIVE_RULE = 'destructive → top tier';
const TRIVIAL_RULE = 'trivial → middle tier';
const CHAT_RULE = 'chat model';

function candidateFor(context: RouteContext, provider: string): AdvisorCandidate | undefined {
  return context.candidates.find((candidate) => candidate.provider === provider);
}

function labelOf(candidate: AdvisorCandidate | undefined, model: string | null): string | null {
  return candidate?.models.find((option) => option.id === model)?.label ?? null;
}

function effortIds(candidate: AdvisorCandidate | undefined): string[] {
  return candidate?.efforts.map((effort) => effort.id) ?? [];
}

export function chatPick(context: RouteContext): AgentPick {
  const candidate = candidateFor(context, context.chat.provider);
  return {
    ...context.chat,
    modelLabel: context.chat.modelLabel ?? labelOf(candidate, context.chat.model),
  };
}

function withModel(pick: AgentPick, model: { id: string; label: string } | null): AgentPick {
  return model ? { ...pick, model: model.id, modelLabel: model.label } : pick;
}

export function jevTierPick(context: RouteContext, tier: RouteTier | null): AgentPick | null {
  if (!tier) return null;
  const candidate = candidateFor(context, context.chat.provider);
  const option = candidate ? tierOptions(candidate).find((entry) => entry.tier === tier) : null;
  return option ? withModel(chatPick(context), option.model) : null;
}

export function builderEffort(context: RouteContext, pick: AgentPick): string | null {
  const card = pick.model
    ? cardFor({ id: pick.model, label: pick.modelLabel }, pick.provider)
    : null;
  return firstReportedEffort(
    [context.providerEffort, context.chat.effort, card?.reasoning.defaultEffort],
    effortIds(candidateFor(context, pick.provider)),
  );
}

function modelsFor(context: RouteContext, provider: string) {
  const candidate = candidateFor(context, provider);
  return candidate ? selectableModels(candidate) : [];
}

function nowOf(context: RouteContext): Date {
  return context.now ?? new Date();
}

function usableFor(context: RouteContext, provider: string) {
  return harnessModels(modelsFor(context, provider), provider, nowOf(context));
}

export function floorFor(context: RouteContext, pick: AgentPick): FlooredPick {
  return floorPick(pick, modelsFor(context, pick.provider), { now: nowOf(context) });
}

function withNote(route: MemberRoute, floored: FlooredPick, role: FloorRole): MemberRoute {
  const next: MemberRoute = { ...route, pick: floored.pick };
  delete next.note;
  if (floored.note) next.note = floorText(floored.note, role);
  return next;
}

export function floorBuilderRoute(context: RouteContext, route: MemberRoute): MemberRoute {
  return withNote(route, floorFor(context, route.pick), 'builder');
}

function flooredOrNull(context: RouteContext, pick: AgentPick | null): AgentPick | null {
  return pick ? floorFor(context, pick).pick : null;
}

function readerFloor(context: RouteContext, route: MemberRoute): FlooredPick {
  if (route.routedBy === 'pinned') {
    return { pick: route.pick, note: retiringNote(route.pick, nowOf(context)) };
  }
  const floored = floorFor(context, route.pick);
  return floored.note?.kind === 'tier_unknown' ? { ...floored, note: null } : floored;
}

function floorReaderRoute(context: RouteContext, route: MemberRoute): MemberRoute {
  const autoWouldUse = flooredOrNull(context, route.autoWouldUse);
  return withNote({ ...route, autoWouldUse }, readerFloor(context, route), 'reader');
}

function familyWords(label: string): string[] {
  return label.split(/[\s-]+/).filter((word) => /^[a-z]+$/i.test(word));
}

export function topFamilies(context: RouteContext): string[] {
  const models = usableFor(context, context.chat.provider);
  const top = topTier(models, context.chat.provider);
  if (!top) return [];
  const others = new Set(
    models.filter((model) => model.id !== top.id).flatMap((model) => familyWords(model.label)),
  );
  return familyWords(top.label).filter((word) => !others.has(word));
}

export function builderComplexity(context: RouteContext, facts: RouteFacts): ComplexSignal | null {
  return firstSignal(complexByRequest(context.request, topFamilies(context)), facts.complex);
}

export function builderTierPick(context: RouteContext, tier: RouteTier | null): AgentPick | null {
  return flooredOrNull(context, jevTierPick(context, tier));
}

function builderRule(base: MemberRoute, complex: ComplexSignal | null, facts: RouteFacts): string {
  if (base.rule === DESTRUCTIVE_RULE) return base.rule;
  if (complex) return `complex → top tier (${complex.reason})`;
  if (facts.setAside && base.routedBy === 'rules') return `${base.rule} (${facts.setAside})`;
  return base.rule;
}

export function routeBuilder(
  context: RouteContext,
  facts: RouteFacts,
  jevTier: RouteTier | null = null,
): MemberRoute {
  const ruled = ruleRoute(context, facts, jevTier);
  const jevPinned = ruled.routedBy === 'pinned' ? pinnedByJev(context, facts, ruled) : null;
  if (jevPinned) return jevPinned;
  const base =
    ruled.routedBy === 'pinned' ? pinnedRuleRoute(context, facts, jevTier, ruled) : ruled;
  const complex = base.routedBy === 'pinned' ? null : builderComplexity(context, facts);
  const autoWouldUse = flooredOrNull(context, base.autoWouldUse);
  const scored = scoredBuilder(context, facts, { ...base, autoWouldUse }, complex);
  if (scored) return scored;
  const floored = floorPick(base.pick, modelsFor(context, base.pick.provider), {
    aim: complex ? 'top' : 'floor',
    now: nowOf(context),
  });
  const rule = builderRule(base, complex, facts);
  const route = withNote({ ...base, rule, autoWouldUse }, floored, 'builder');
  return { ...route, pick: { ...route.pick, effort: builderEffort(context, route.pick) } };
}

function pinnedByJev(context: RouteContext, facts: RouteFacts, base: MemberRoute) {
  if (!jevRated(facts.ratings)) return null;
  const complex = builderComplexity(context, facts);
  const asRules: MemberRoute = { ...base, routedBy: 'rules', rule: CHAT_RULE };
  const scored = scoredBuilder(context, facts, asRules, complex, true);
  if (!scored) return null;
  const step = pinnedStep(base.pick, scored.pick);
  if (step === 'same' || (step === 'below' && !taskClearlySimple(facts.ratings))) return null;
  const rule = scored.escalation ? scored.rule : pinnedRule(step, base.pick);
  return { ...scored, routedBy: 'jev' as const, rule };
}

function asTierModel(pick: AgentPick) {
  return { id: pick.model ?? '', label: pick.modelLabel ?? pick.model ?? '' };
}

function drivers(signals: TaskSignals): string {
  const rated = Object.entries(signals).filter(([, signal]) => signal.source === 'jev');
  return rated.length > 0 ? signalText(signals) : `${signalText(signals)}, rules only`;
}

function scoredRule(
  score: RouteScore,
  facts: RouteFacts,
  complex: ComplexSignal | null,
  ladder: readonly { id: string }[],
): string {
  const up = TIER_RANK[score.pick.tier] - TIER_RANK[score.base.tier];
  const keptSession = score.anchor === 'session' && score.pick.id === score.base.id;
  if (keptSession) return KEPT_FOR_SESSION;
  const highest = score.pick.id === ladder.at(-1)?.id;
  if (complex && (highest || TIER_RANK[score.pick.tier] >= TIER_RANK.top)) {
    return `complex → top tier (${complex.reason})`;
  }
  if (up > 0) return `score → ${score.pick.tier} tier (${drivers(score.signals)})`;
  if (facts.trivial && score.pick.id === ladder[0]?.id) return TRIVIAL_RULE;
  if (up < 0) return `simple → ${score.pick.tier} tier (${drivers(score.signals)})`;
  return CHAT_RULE;
}

function usableSession(
  context: RouteContext,
  session: ResumableSession | null | undefined,
): { session: ResumableSession | null; choice: SessionChoice | null } {
  if (!session || session.pick.provider !== context.chat.provider) {
    return { session: null, choice: null };
  }
  if (!belowFloor(session.pick, nowOf(context))) return { session, choice: null };
  const reason = floorReason(session.pick, 'builder', nowOf(context));
  return { session: null, choice: { kept: false, reason, session: session.pick } };
}

function sessionChoiceFor(
  score: RouteScore,
  session: ResumableSession | null,
  rule: string,
  now: Date,
): SessionChoice | null {
  if (!session || score.anchor !== 'session') return null;
  if (score.pick.id === score.base.id) {
    return { kept: true, reason: keptText(session, now), session: session.pick };
  }
  return { kept: false, reason: leftText(rule, session, now), session: session.pick };
}

function scoredBuilder(
  context: RouteContext,
  facts: RouteFacts,
  base: MemberRoute,
  complex: ComplexSignal | null,
  anchoredAtPin = false,
): MemberRoute | null {
  if (base.routedBy === 'pinned' || base.rule === DESTRUCTIVE_RULE) return null;
  if (context.routing === 'pinned' && !anchoredAtPin) return null;
  if (complex?.source === 'user') return null;
  const now = nowOf(context);
  const provider = context.chat.provider;
  const models = modelsFor(context, provider);
  const chat = floorPick(chatPick(context), models, { now });
  if (!chat.pick.model) return null;
  const warm = usableSession(context, facts.session);
  const eligible = builderModels(models, provider, now);
  const scored = scoreEscalation(
    {
      provider,
      models: eligible,
      chat: asTierModel(chat.pick),
      session: warm.session,
      signals: taskSignals({ ...facts, complex }, facts.ratings),
      stats: candidateFor(context, provider)?.stats ?? [],
      now,
      demoted: facts.demoted ?? null,
    },
    facts.prior ?? null,
    effortIds(candidateFor(context, provider)),
    facts.arm ?? null,
  );
  if (!scored) return null;
  const { score, escalation } = scored;
  const kept = warm.session?.pick.model === score.pick.id ? warm.session : null;
  const pick = kept?.pick ?? { ...chat.pick, model: score.pick.id, modelLabel: score.pick.label };
  const ruled = scoredRule(score, facts, complex, eligible);
  const plain = ruled === CHAT_RULE || ruled === TRIVIAL_RULE;
  const rule =
    (escalation && escalationRule(escalation)) ??
    (scored.stayedOn ? stayedRule(scored.stayedOn) : null) ??
    (facts.setAside && plain ? `${ruled} (${facts.setAside})` : ruled);
  const escalated =
    escalation && warm.session ? escalationChoice(escalation, warm.session, now) : null;
  const choice = escalated ?? sessionChoiceFor(score, warm.session, rule, now) ?? warm.choice;
  const effort = escalation?.kind === 'effort' ? escalation.to.effort : null;
  const route: MemberRoute = {
    ...base,
    pick: kept
      ? { ...pick, effort: effort ?? pick.effort }
      : { ...pick, effort: builderEffort(context, pick) },
    rule,
    score,
    ...(choice ? { sessionChoice: choice } : {}),
    ...(escalation ? { escalation } : {}),
  };
  delete route.note;
  if (ruled === CHAT_RULE && chat.note && pick.model === chat.pick.model) {
    route.note = floorText(chat.note, 'builder');
  }
  return route;
}

export const SPARK_OFF_RULE = 'Spark off → your pick';

export function soloRoute(context: RouteContext): MemberRoute {
  return { pick: chatPick(context), routedBy: 'pinned', rule: SPARK_OFF_RULE, autoWouldUse: null };
}

function pinnedRuleRoute(
  context: RouteContext,
  facts: RouteFacts,
  jevTier: RouteTier | null,
  pinned: MemberRoute,
): MemberRoute {
  const ruled = ruleRoute({ ...context, routing: 'auto' }, facts, jevTier);
  if (facts.destructive) return ruled;
  const trivialBelow =
    ruled.rule === TRIVIAL_RULE && pinnedStep(pinned.pick, ruled.pick) === 'below';
  return trivialBelow ? ruled : pinned;
}

function ruleRoute(
  context: RouteContext,
  facts: RouteFacts,
  jevTier: RouteTier | null,
): MemberRoute {
  const chat = chatPick(context);
  const autoWouldUse = jevTierPick(context, jevTier);
  if (context.routing === 'pinned') {
    return { pick: chat, routedBy: 'pinned', rule: 'pinned', autoWouldUse };
  }
  const models = usableFor(context, context.chat.provider);
  if (facts.destructive) {
    const top = topTier(models, context.chat.provider);
    return {
      pick: withModel(chat, top),
      routedBy: 'rules',
      rule: DESTRUCTIVE_RULE,
      autoWouldUse,
    };
  }
  const middle = facts.trivial ? floorModel(models, context.chat.provider, nowOf(context)) : null;
  if (middle) {
    return { pick: withModel(chat, middle), routedBy: 'rules', rule: TRIVIAL_RULE, autoWouldUse };
  }
  return { pick: chat, routedBy: 'rules', rule: CHAT_RULE, autoWouldUse };
}

export const MAIN_SESSION_RULE = "the chat's own model, kept for the whole chat";

function mainPick(context: RouteContext): AgentPick {
  const chat = chatPick(context);
  const id = context.mainModel;
  if (context.routing === 'pinned' || !id || id === chat.model) return chat;
  const label = labelOf(candidateFor(context, chat.provider), id);
  return { ...chat, model: id, modelLabel: label };
}

export function mainSessionRoute(
  context: RouteContext,
  jevTier: RouteTier | null = null,
): MemberRoute {
  const base = ruleRoute(context, { trivial: false, destructive: false }, jevTier);
  if (base.routedBy === 'pinned') return floorReaderRoute(context, base);
  const route: MemberRoute = { ...base, pick: mainPick(context), rule: MAIN_SESSION_RULE };
  return floorReaderRoute(context, route);
}

export function ruleCriticPick(
  context: RouteContext,
  built: readonly BuiltShare[] = [],
  provider = criticProvider(context, built),
): AgentPick {
  const candidate = candidateFor(context, provider);
  const effort = highEffort(effortIds(candidate)) ?? 'high';
  const models = modelsFor(context, provider);
  const usable = usableFor(context, provider);
  if (provider === context.chat.provider) {
    const stronger = oneTierUp(models, context.chat.model, provider, usable);
    if (!stronger) return { ...chatPick(context), effort };
    return { provider, model: stronger.id, modelLabel: stronger.label, effort };
  }
  const ladder = tierLadder(usable, provider);
  const middle =
    ladder.find((model) => modelTier(model, provider) === 1) ?? ladder.at(-1) ?? usable[0];
  return { provider, model: middle?.id ?? null, modelLabel: middle?.label ?? null, effort };
}

export function routeCritic(
  context: RouteContext,
  built: readonly BuiltShare[] = [],
  provider?: string,
): MemberRoute {
  const route: MemberRoute = {
    pick: ruleCriticPick(context, built, provider),
    routedBy: 'rules',
    rule: 'critic',
    autoWouldUse: null,
  };
  return floorReaderRoute(context, route);
}

export function rereviewCritic(context: RouteContext, previous: MemberRoute): MemberRoute {
  const efforts = effortIds(candidateFor(context, previous.pick.provider));
  const effort = loweredEffort(efforts, previous.pick.effort, CRITIC_REREVIEW_EFFORT);
  if (effort === previous.pick.effort) return previous;
  return { ...previous, pick: { ...previous.pick, effort } };
}

export const SMALL_DIFF_NOTE = 'small diff: first review at medium effort';

export function smallDiffCritic(context: RouteContext, route: MemberRoute): MemberRoute {
  const efforts = effortIds(candidateFor(context, route.pick.provider));
  const effort = loweredEffort(efforts, route.pick.effort, CRITIC_SMALL_DIFF_EFFORT);
  if (effort === route.pick.effort) return route;
  return { ...route, pick: { ...route.pick, effort }, note: SMALL_DIFF_NOTE };
}

export function escalate(context: RouteContext, previous: MemberRoute): MemberRoute {
  const { provider, model } = previous.pick;
  const candidate = candidateFor(context, provider);
  const up = oneTierUp(modelsFor(context, provider), model, provider, usableFor(context, provider));
  const pick: AgentPick = up
    ? {
        ...previous.pick,
        model: up.id,
        modelLabel: up.label,
        effort: escalatedEffort(effortIds(candidate), previous.pick.effort),
      }
    : { ...previous.pick, effort: strongerEffort(effortIds(candidate), previous.pick.effort) };
  const next: MemberRoute = { ...previous, pick, rule: 'one tier up' };
  delete next.note;
  return next;
}

export function escalateBuilder(context: RouteContext, previous: MemberRoute): MemberRoute {
  return floorBuilderRoute(context, escalate(context, previous));
}
