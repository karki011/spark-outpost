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
  load: ReadonlyMap<string, number>;
  parallel: boolean;
}

export interface AssignablePiece {
  key: string;
  sizeEstimate: number;
  research: boolean;
}

export interface PieceAssignment {
  key: string;
  pick: AgentPick;
  reason: string;
}

interface Option {
  provider: string;
  name: string;
  pick: AgentPick;
}

const UNKNOWN_STRENGTH = 0.5;

function nowOf(facts: AssignFacts): Date {
  return facts.route.now ?? new Date();
}

function candidateFor(facts: AssignFacts, provider: string): AdvisorCandidate | undefined {
  return facts.route.candidates.find((candidate) => candidate.provider === provider);
}

function nameOf(facts: AssignFacts, provider: string): string {
  return candidateFor(facts, provider)?.name ?? provider;
}

export function builderStrength(candidate: AdvisorCandidate): number {
  const stats = (candidate.stats ?? []).filter(
    (stat) => stat.role === 'builder' && stat.provider === candidate.provider,
  );
  if (stats.length === 0) return UNKNOWN_STRENGTH;
  const passed = stats.reduce((sum, stat) => sum + stat.passed, 0);
  const runs = stats.reduce((sum, stat) => sum + stat.n, 0);
  return (passed + 1) / (runs + 2);
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

function pickFor(facts: AssignFacts, provider: string): AgentPick | null {
  if (provider === facts.builder.provider) return facts.builder;
  const candidate = candidateFor(facts, provider);
  return candidate ? otherProviderPick(facts, candidate) : null;
}

function rank(facts: AssignFacts, a: AdvisorCandidate, b: AdvisorCandidate): number {
  const strength = builderStrength(b) - builderStrength(a);
  if (strength !== 0) return strength;
  const load = (facts.load.get(a.provider) ?? 0) - (facts.load.get(b.provider) ?? 0);
  return load !== 0 ? load : a.provider.localeCompare(b.provider);
}

export function eligibleProviders(
  facts: AssignFacts,
  excluded: ReadonlySet<string> = new Set(),
): Option[] {
  const usable = (provider: string) => !excluded.has(provider) && !facts.unhealthy.has(provider);
  const others = facts.route.candidates
    .filter((candidate) => candidate.provider !== facts.builder.provider)
    .filter((candidate) => usable(candidate.provider))
    .sort((a, b) => rank(facts, a, b));
  const ordered = [
    ...(usable(facts.builder.provider) ? [facts.builder.provider] : []),
    ...others.map((candidate) => candidate.provider),
  ];
  return ordered.flatMap((provider) => {
    const pick = pickFor(facts, provider);
    return pick ? [{ provider, name: nameOf(facts, provider), pick }] : [];
  });
}

function chatReason(facts: AssignFacts, first: Option): string {
  if (first.provider === facts.builder.provider) return 'in order → the chat provider';
  const why = facts.unhealthy.get(facts.builder.provider) ?? 'unavailable';
  return `in order → ${first.name} (${nameOf(facts, facts.builder.provider)} ${why})`;
}

export function assignPieces(
  pieces: readonly AssignablePiece[],
  facts: AssignFacts,
): PieceAssignment[] {
  const fixed = (reason: string) =>
    pieces.map((piece) => ({ key: piece.key, pick: facts.builder, reason }));
  if (facts.route.routing === 'pinned') return fixed('pinned model');
  const options = eligibleProviders(facts);
  const first = options[0];
  if (!first) return fixed('no other provider is healthy');
  if (!facts.parallel) {
    return pieces.map((piece) => ({
      key: piece.key,
      pick: first.pick,
      reason: chatReason(facts, first),
    }));
  }
  const building = pieces
    .filter((piece) => !piece.research)
    .sort((a, b) => b.sizeEstimate - a.sizeEstimate || a.key.localeCompare(b.key));
  const spread = new Map(
    building.map((piece, index) => [piece.key, options[index % options.length]!]),
  );
  return pieces.map((piece) => {
    const option = spread.get(piece.key) ?? first;
    const reason = piece.research
      ? 'read-only → the first healthy provider'
      : `parallel → ${option.name} (spread by size)`;
    return { key: piece.key, pick: option.pick, reason };
  });
}

export function fallbackPick(facts: AssignFacts, tried: ReadonlySet<string>): Option | null {
  return eligibleProviders(facts, tried)[0] ?? null;
}

export function providerOption(facts: AssignFacts, provider: string): Option | null {
  return eligibleProviders(facts).find((option) => option.provider === provider) ?? null;
}
