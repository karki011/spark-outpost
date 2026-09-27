import { ACT_AT_FRONTIER } from '../advisor/gate.ts';
import type { AdvisorCandidate } from '../advisor/advice.ts';
import type { AgentPick, Gate, RouteSource } from '@spark-outpost/contracts';
import { cardFor, isFrontier } from './cards.ts';
import { tierInfo, type TierSource } from '../orchestration/tiers.ts';

export interface FrontierRecord {
  provider: string;
  allowed: boolean;
  offered: boolean;
  picked: boolean;
}

export interface WhyInput {
  pick: AgentPick;
  routedBy: RouteSource;
  jevPick: AgentPick | null;
  gate: Gate | null;
  rule: string;
  candidate: AdvisorCandidate | undefined;
}

function labelOf(pick: AgentPick): string {
  return pick.modelLabel ?? pick.model ?? 'the agent default';
}

function pickModel(pick: AgentPick) {
  return { id: pick.model ?? '', label: pick.modelLabel ?? '' };
}

export function frontierRecord(input: WhyInput): FrontierRecord | null {
  const provider = input.jevPick?.provider ?? input.pick.provider;
  const candidate = input.candidate;
  const hasFrontier =
    candidate?.models.some((model) => isFrontier(model, candidate.provider)) ?? false;
  const picked = input.jevPick ? isFrontier(pickModel(input.jevPick), provider) : false;
  if (!hasFrontier && !picked) return null;
  const allowed = candidate?.allowFrontier ?? false;
  return { provider, allowed, offered: allowed && hasFrontier, picked };
}

export function tierSourceOf(pick: AgentPick): TierSource {
  return tierInfo(pickModel(pick), pick.provider).source;
}

export function whyLine(input: WhyInput): string {
  const label = labelOf(input.pick);
  const card = cardFor(pickModel(input.pick), input.pick.provider);
  const tier = card ? ` · ${card.tier} tier` : '';
  const frontier = frontierRecord(input);
  const off = frontier && !frontier.allowed ? ' · frontier off' : '';
  if (input.routedBy === 'pinned') return `Why ${label}: pinned in this chat`;
  if (input.routedBy === 'jev') {
    const confidence = input.gate ? ` ${input.gate.confidence.toFixed(2)}` : '';
    return `Why ${label}: Jev${confidence}${tier}${off}`;
  }
  const head = `Why ${label}: rule ${input.rule}${tier}`;
  if (!input.jevPick || !input.gate) return `${head}${off}`;
  const needs =
    frontier?.picked && input.gate.actAt === ACT_AT_FRONTIER
      ? ' · frontier needs 0.95'
      : ', below the gate';
  return `${head} · Jev picked ${labelOf(input.jevPick)} at ${input.gate.confidence.toFixed(2)}${needs}${off}`;
}
