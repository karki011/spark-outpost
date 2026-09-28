import type { AgentPick, ModelRouting, RouteSource, RouteTier } from '@spark-outpost/contracts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { selectableModels, tierOptions } from '../advisor/intake-questions.ts';
import { cardFor } from '../model-cards/cards.ts';
import { firstReportedEffort } from '../providers/efforts.ts';
import { complexByRequest, firstSignal, type ComplexSignal } from './builder-complexity.ts';
import {
  floorModel,
  floorPick,
  floorText,
  harnessModels,
  retiringNote,
  type FloorRole,
  type FlooredPick,
} from './model-floor.ts';
import {
  escalatedEffort,
  highEffort,
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
  candidates: readonly AdvisorCandidate[];
  request?: string;
  now?: Date;
}

export interface MemberRoute {
  pick: AgentPick;
  routedBy: RouteSource;
  rule: string;
  autoWouldUse: AgentPick | null;
  note?: string;
}

export interface RouteFacts {
  trivial: boolean;
  destructive: boolean;
  complex?: ComplexSignal | null;
  setAside?: string;
}

export const DESTRUCTIVE_RULE = 'destructive → top tier';

export function candidateFor(
  context: RouteContext,
  provider: string,
): AdvisorCandidate | undefined {
  return context.candidates.find((candidate) => candidate.provider === provider);
}

function labelOf(candidate: AdvisorCandidate | undefined, model: string | null): string | null {
  return candidate?.models.find((option) => option.id === model)?.label ?? null;
}

export function effortIds(candidate: AdvisorCandidate | undefined): string[] {
  return candidate?.efforts.map((effort) => effort.id) ?? [];
}

export function criticProvider(context: RouteContext): string {
  const other = context.candidates.find(
    (candidate) => candidate.provider !== context.chat.provider,
  );
  return other?.provider ?? context.chat.provider;
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

export function floorReaderRoute(context: RouteContext, route: MemberRoute): MemberRoute {
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

export function routeBuilder(
  context: RouteContext,
  facts: RouteFacts,
  jevTier: RouteTier | null = null,
): MemberRoute {
  const base = ruleRoute(context, facts, jevTier);
  const complex = base.routedBy === 'pinned' ? null : builderComplexity(context, facts);
  const floored = floorPick(base.pick, modelsFor(context, base.pick.provider), {
    aim: complex ? 'top' : 'floor',
    now: nowOf(context),
  });
  const rule =
    complex && base.rule !== DESTRUCTIVE_RULE
      ? `complex → top tier (${complex.reason})`
      : !complex && facts.setAside && base.routedBy === 'rules' && base.rule !== DESTRUCTIVE_RULE
        ? `${base.rule} (${facts.setAside})`
        : base.rule;
  const autoWouldUse = flooredOrNull(context, base.autoWouldUse);
  const route = withNote({ ...base, rule, autoWouldUse }, floored, 'builder');
  return { ...route, pick: { ...route.pick, effort: builderEffort(context, route.pick) } };
}

export const TRIVIAL_RULE = 'trivial → middle tier';

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
  return { pick: chat, routedBy: 'rules', rule: 'chat model', autoWouldUse };
}

export function routeMemberModel(
  context: RouteContext,
  facts: RouteFacts,
  jevTier: RouteTier | null = null,
): MemberRoute {
  return floorReaderRoute(context, ruleRoute(context, facts, jevTier));
}

export function ruleCriticPick(context: RouteContext): AgentPick {
  const provider = criticProvider(context);
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

export function routeCritic(context: RouteContext): MemberRoute {
  const route: MemberRoute = {
    pick: ruleCriticPick(context),
    routedBy: 'rules',
    rule: 'critic',
    autoWouldUse: null,
  };
  return floorReaderRoute(context, route);
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
