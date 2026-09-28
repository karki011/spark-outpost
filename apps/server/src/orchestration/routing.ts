import type { AgentPick, ModelRouting, RouteSource, RouteTier } from '@spark-outpost/contracts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { selectableModels, tierOptions } from '../advisor/intake-questions.ts';
import { cardFor } from '../model-cards/cards.ts';
import { firstReportedEffort } from '../providers/efforts.ts';
import { complexByRequest, firstSignal, type ComplexSignal } from './builder-complexity.ts';
import { builderPick, floorText, type FlooredPick } from './builder-floor.ts';
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

export function floorBuilderPick(context: RouteContext, pick: AgentPick): FlooredPick {
  return builderPick(pick, modelsFor(context, pick.provider));
}

function withNote(route: MemberRoute, floored: FlooredPick): MemberRoute {
  const next: MemberRoute = { ...route, pick: floored.pick };
  delete next.note;
  if (floored.note) next.note = floorText(floored.note);
  return next;
}

export function floorBuilderRoute(context: RouteContext, route: MemberRoute): MemberRoute {
  return withNote(route, floorBuilderPick(context, route.pick));
}

function familyWords(label: string): string[] {
  return label.split(/[\s-]+/).filter((word) => /^[a-z]+$/i.test(word));
}

export function topFamilies(context: RouteContext): string[] {
  const models = modelsFor(context, context.chat.provider);
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
  const pick = jevTierPick(context, tier);
  return pick ? floorBuilderPick(context, pick).pick : null;
}

export function routeBuilder(
  context: RouteContext,
  facts: RouteFacts,
  jevTier: RouteTier | null = null,
): MemberRoute {
  const base = routeMemberModel(context, facts, jevTier);
  const complex = base.routedBy === 'pinned' ? null : builderComplexity(context, facts);
  const floored = builderPick(
    base.pick,
    modelsFor(context, base.pick.provider),
    complex ? 'top' : 'floor',
  );
  const rule =
    complex && base.rule !== DESTRUCTIVE_RULE
      ? `complex → top tier (${complex.reason})`
      : base.rule;
  const autoWouldUse = base.autoWouldUse ? floorBuilderPick(context, base.autoWouldUse).pick : null;
  const route = withNote({ ...base, rule, autoWouldUse }, floored);
  return { ...route, pick: { ...route.pick, effort: builderEffort(context, route.pick) } };
}

export function routeMemberModel(
  context: RouteContext,
  facts: RouteFacts,
  jevTier: RouteTier | null = null,
): MemberRoute {
  const chat = chatPick(context);
  const autoWouldUse = jevTierPick(context, jevTier);
  if (context.routing === 'pinned') {
    return { pick: chat, routedBy: 'pinned', rule: 'pinned', autoWouldUse };
  }
  const candidate = candidateFor(context, context.chat.provider);
  const models = candidate ? selectableModels(candidate) : [];
  const ladder = tierLadder(models, context.chat.provider);
  if (facts.destructive) {
    const top = topTier(models, context.chat.provider);
    return {
      pick: withModel(chat, top),
      routedBy: 'rules',
      rule: DESTRUCTIVE_RULE,
      autoWouldUse,
    };
  }
  if (facts.trivial && ladder[0]) {
    return {
      pick: withModel(chat, ladder[0]),
      routedBy: 'rules',
      rule: 'trivial → small tier',
      autoWouldUse,
    };
  }
  return { pick: chat, routedBy: 'rules', rule: 'chat model', autoWouldUse };
}

export function ruleCriticPick(context: RouteContext): AgentPick {
  const provider = criticProvider(context);
  const candidate = candidateFor(context, provider);
  const effort = highEffort(effortIds(candidate)) ?? 'high';
  const models = candidate ? selectableModels(candidate) : [];
  if (provider === context.chat.provider) {
    const stronger = oneTierUp(models, context.chat.model, provider);
    if (!stronger) return { ...chatPick(context), effort };
    return { provider, model: stronger.id, modelLabel: stronger.label, effort };
  }
  const ladder = tierLadder(models, provider);
  const middle =
    ladder.find((model) => modelTier(model, provider) === 1) ?? ladder.at(-1) ?? models[0];
  return { provider, model: middle?.id ?? null, modelLabel: middle?.label ?? null, effort };
}

export function routeCritic(context: RouteContext): MemberRoute {
  return { pick: ruleCriticPick(context), routedBy: 'rules', rule: 'critic', autoWouldUse: null };
}

export function escalate(context: RouteContext, previous: MemberRoute): MemberRoute {
  const candidate = candidateFor(context, previous.pick.provider);
  const models = candidate ? selectableModels(candidate) : [];
  const up = oneTierUp(models, previous.pick.model, previous.pick.provider);
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
