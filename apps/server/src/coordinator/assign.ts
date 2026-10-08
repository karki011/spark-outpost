import type { AgentPick } from '@spark-outpost/contracts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import { selectableModels } from '../advisor/intake-questions.ts';
import { floorModel, floorPick } from '../orchestration/model-floor.ts';
import { builderEffort, type RouteContext } from '../orchestration/routing.ts';

export interface AssignFacts {
  route: RouteContext;
  builder: AgentPick;
  complex: boolean;
  unhealthy: ReadonlyMap<string, string>;
}

interface Option {
  provider: string;
  pick: AgentPick;
}

function nowOf(facts: AssignFacts): Date {
  return facts.route.now ?? new Date();
}

function candidateFor(facts: AssignFacts, provider: string): AdvisorCandidate | undefined {
  return facts.route.candidates.find((candidate) => candidate.provider === provider);
}

export interface MeasuredRate {
  rate: number;
  runs: number;
}

export function measuredRate(
  candidate: AdvisorCandidate,
  model: string | null = null,
  category: string | null = null,
): MeasuredRate | null {
  const stats = (candidate.stats ?? []).filter(
    (stat) =>
      stat.role === 'builder' &&
      stat.provider === candidate.provider &&
      (model === null || stat.agentModel === model) &&
      (category === null || stat.category === category),
  );
  if (stats.length === 0) return null;
  const passed = stats.reduce((sum, stat) => sum + stat.passed, 0);
  const runs = stats.reduce((sum, stat) => sum + stat.n, 0);
  return { rate: (passed + 1) / (runs + 2), runs };
}

export function measuredStrength(
  candidate: AdvisorCandidate,
  model: string | null = null,
): number | null {
  return measuredRate(candidate, model)?.rate ?? null;
}

function otherProviderPick(facts: AssignFacts, candidate: AdvisorCandidate): AgentPick | null {
  if (candidate.doAvailable === false) return null;
  const models = selectableModels(candidate);
  const floor = floorModel(models, candidate.provider, nowOf(facts));
  if (!floor) return null;
  const base: AgentPick = {
    provider: candidate.provider,
    model: floor.id,
    modelLabel: floor.label,
    effort: null,
  };
  const aimed = floorPick(base, models, {
    aim: facts.complex ? 'top' : 'floor',
    now: nowOf(facts),
  }).pick;
  return { ...aimed, effort: builderEffort(facts.route, aimed) };
}

export function providerOption(facts: AssignFacts, provider: string): Option | null {
  if (facts.unhealthy.has(provider)) return null;
  if (provider === facts.builder.provider) return { provider, pick: facts.builder };
  const candidate = candidateFor(facts, provider);
  const pick = candidate ? otherProviderPick(facts, candidate) : null;
  return pick ? { provider, pick } : null;
}
