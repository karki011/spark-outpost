import type { AgentPick, ModelRouting, RouteSource, RouteTier } from '@spark-outpost/contracts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { selectableModels, tierOptions } from '../advisor/intake-questions.ts';
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
  candidates: readonly AdvisorCandidate[];
}

export interface MemberRoute {
  pick: AgentPick;
  routedBy: RouteSource;
  rule: string;
  autoWouldUse: AgentPick | null;
}

export interface RouteFacts {
  trivial: boolean;
  destructive: boolean;
}

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

export function routeBuilder(
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
      rule: 'destructive → top tier',
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
  return { ...previous, pick, rule: 'one tier up' };
}
