import type {
  AgentPick,
  Gate,
  InvolvementLevel,
  ModelRouting,
  Risk,
  RouteSource,
} from '@spark-outpost/contracts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { gate } from '../advisor/gate.ts';
import { selectableModels, type SystemOneResponse } from '../advisor/intake-questions.ts';
import type { RoutePick } from './jev-questions.ts';
import {
  effortRank,
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
  risk: Risk;
  level: InvolvementLevel;
}

export interface MemberRoute {
  pick: AgentPick;
  routedBy: RouteSource;
  autoWouldUse: AgentPick | null;
  gate: Gate | null;
}

export interface JevPick {
  pick: AgentPick;
  confidence: number | null;
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

export function pickFromRoute(
  provider: string,
  candidate: AdvisorCandidate,
  route: RoutePick,
): JevPick {
  return {
    pick: {
      provider,
      model: route.model?.id ?? null,
      modelLabel: route.model?.label ?? null,
      effort: route.effort,
    },
    confidence: route.confidence,
  };
}

export function intakePickFor(
  context: RouteContext,
  provider: string,
  response: SystemOneResponse | null,
): JevPick | null {
  const candidate = candidateFor(context, provider);
  if (!candidate || !response) return null;
  const models = selectableModels(candidate);
  const modelAnswer = response.answers[`model_${provider}`];
  const effortAnswer = response.answers[`effort_${provider}`];
  const model =
    modelAnswer?.type === 'choice'
      ? models.find((option) => option.id === modelAnswer.choice)
      : models.length === 1
        ? models[0]
        : undefined;
  if (!model) return null;
  const index = effortAnswer?.type === 'score' ? Math.round(effortAnswer.score) : -1;
  const effort = candidate.efforts[index]?.id ?? context.chat.effort;
  return {
    pick: { provider, model: model.id, modelLabel: model.label, effort },
    confidence: modelAnswer?.type === 'choice' ? modelAnswer.confidence : null,
  };
}

function tierOf(pick: AgentPick): number | null {
  return modelTier({ id: pick.model ?? '', label: pick.modelLabel ?? '' });
}

export function notPricier(pick: AgentPick, baseline: AgentPick): boolean {
  if (pick.provider !== baseline.provider) return false;
  const tier = tierOf(pick);
  const baseTier = tierOf(baseline);
  if (tier === null || baseTier === null || tier > baseTier) return false;
  return effortRank(pick.effort) <= effortRank(baseline.effort);
}

function gated(context: RouteContext, jev: JevPick, baseline: AgentPick): Gate {
  const downgrade = notPricier(jev.pick, baseline);
  return gate({ confidence: jev.confidence ?? 1 }, context.risk, context.level, { downgrade });
}

export function chatPick(context: RouteContext): AgentPick {
  const candidate = candidateFor(context, context.chat.provider);
  return {
    ...context.chat,
    modelLabel: context.chat.modelLabel ?? labelOf(candidate, context.chat.model),
  };
}

export function routeWorker(context: RouteContext, jev: JevPick | null): MemberRoute {
  const pinned = chatPick(context);
  if (context.routing === 'pinned') {
    return { pick: pinned, routedBy: 'pinned', autoWouldUse: jev?.pick ?? null, gate: null };
  }
  if (!jev) return { pick: pinned, routedBy: 'rules', autoWouldUse: null, gate: null };
  const decision = gated(context, jev, pinned);
  return decision.decision === 'act'
    ? { pick: jev.pick, routedBy: 'jev', autoWouldUse: jev.pick, gate: decision }
    : { pick: pinned, routedBy: 'rules', autoWouldUse: jev.pick, gate: decision };
}

export function topTierPick(context: RouteContext, provider: string): AgentPick {
  const candidate = candidateFor(context, provider);
  const top = candidate ? topTier(selectableModels(candidate)) : null;
  const effort = highEffort(effortIds(candidate)) ?? 'high';
  if (!top) return { ...chatPick(context), provider, effort };
  return { provider, model: top.id, modelLabel: top.label, effort };
}

export function ruleCriticPick(context: RouteContext): AgentPick {
  const provider = criticProvider(context);
  const candidate = candidateFor(context, provider);
  const effort = highEffort(effortIds(candidate)) ?? 'high';
  if (provider === context.chat.provider) return { ...chatPick(context), effort };
  const models = candidate ? selectableModels(candidate) : [];
  const ladder = tierLadder(models);
  const middle = ladder.find((model) => modelTier(model) === 1) ?? ladder.at(-1) ?? models[0];
  return { provider, model: middle?.id ?? null, modelLabel: middle?.label ?? null, effort };
}

export function routeCritic(context: RouteContext, jev: JevPick | null): MemberRoute {
  const rules = ruleCriticPick(context);
  if (!jev) return { pick: rules, routedBy: 'rules', autoWouldUse: null, gate: null };
  if (context.routing === 'pinned') {
    return { pick: rules, routedBy: 'rules', autoWouldUse: jev.pick, gate: null };
  }
  const decision = gated(context, jev, rules);
  return decision.decision === 'act'
    ? { pick: jev.pick, routedBy: 'jev', autoWouldUse: jev.pick, gate: decision }
    : { pick: rules, routedBy: 'rules', autoWouldUse: jev.pick, gate: decision };
}

export function escalate(context: RouteContext, previous: MemberRoute): MemberRoute {
  const candidate = candidateFor(context, previous.pick.provider);
  const models = candidate ? selectableModels(candidate) : [];
  const up = oneTierUp(models, previous.pick.model);
  const pick: AgentPick = up
    ? {
        ...previous.pick,
        model: up.id,
        modelLabel: up.label,
        effort: escalatedEffort(effortIds(candidate), previous.pick.effort),
      }
    : { ...previous.pick, effort: strongerEffort(effortIds(candidate), previous.pick.effort) };
  return { ...previous, pick, gate: null };
}
