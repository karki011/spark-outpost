import type { AgentPick, RouteSource } from '@spark-outpost/contracts';
import { cardFor } from './cards.ts';

export interface WhyInput {
  pick: AgentPick;
  routedBy: RouteSource;
  rule: string;
  autoWouldUse: AgentPick | null;
  note?: string;
}

function labelOf(pick: AgentPick): string {
  return pick.modelLabel ?? pick.model ?? 'the agent default';
}

function pickModel(pick: AgentPick) {
  return { id: pick.model ?? '', label: pick.modelLabel ?? '' };
}

export function samePickModel(a: AgentPick, b: AgentPick): boolean {
  return a.provider === b.provider && a.model === b.model;
}

export function jevLabel(jev: AgentPick, pick: AgentPick): string {
  const label = labelOf(jev);
  return jev.provider === pick.provider ? label : `${label} (${jev.provider})`;
}

export function whyLine(input: WhyInput): string {
  const label = labelOf(input.pick);
  const card = cardFor(pickModel(input.pick), input.pick.provider);
  const tier = card ? ` · ${card.tier} tier` : '';
  const base =
    input.routedBy === 'pinned'
      ? `Why ${label}: pinned in this chat`
      : `Why ${label}: rule ${input.rule}${tier}`;
  const head = input.note ? `${base} · ${input.note}` : base;
  const jev = input.autoWouldUse;
  if (!jev || samePickModel(jev, input.pick)) return head;
  return `${head} · Jev would have used ${jevLabel(jev, input.pick)}`;
}
