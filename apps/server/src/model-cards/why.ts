import type { AgentPick, RouteSource } from '@spark-outpost/contracts';
import { cardFor } from './cards.ts';
import { tierInfo, type TierSource } from '../orchestration/tiers.ts';

export interface WhyInput {
  pick: AgentPick;
  routedBy: RouteSource;
  rule: string;
  autoWouldUse: AgentPick | null;
}

function labelOf(pick: AgentPick): string {
  return pick.modelLabel ?? pick.model ?? 'the agent default';
}

function pickModel(pick: AgentPick) {
  return { id: pick.model ?? '', label: pick.modelLabel ?? '' };
}

export function tierSourceOf(pick: AgentPick): TierSource {
  return tierInfo(pickModel(pick), pick.provider).source;
}

export function whyLine(input: WhyInput): string {
  const label = labelOf(input.pick);
  const card = cardFor(pickModel(input.pick), input.pick.provider);
  const tier = card ? ` · ${card.tier} tier` : '';
  const head =
    input.routedBy === 'pinned'
      ? `Why ${label}: pinned in this chat`
      : `Why ${label}: rule ${input.rule}${tier}`;
  const jev = input.autoWouldUse;
  if (!jev || jev.model === input.pick.model) return head;
  return `${head} · Jev would have used ${labelOf(jev)}`;
}
