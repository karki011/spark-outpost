import type { AgentPick } from '@spark-outpost/contracts';
import { HANDOFF_TOKENS } from '../advisor/policy.ts';
import { cardFor } from '../model-cards/cards.ts';
import {
  lostReasoningUsd,
  sessionWarm,
  writePrice,
  type ResumableSession,
} from '../model-access/switch-cost.ts';
import type { TierModel } from './tiers.ts';

export { sessionWarm, switchCostUsd, type ResumableSession } from '../model-access/switch-cost.ts';

export interface SessionChoice {
  kept: boolean;
  reason: string;
  session: AgentPick;
}

export function handoffCostUsd(session: ResumableSession, to: TierModel): number | null {
  if (to.id === session.pick.model) return 0;
  const target = cardFor(to, session.pick.provider)?.price;
  if (!target) return null;
  return (HANDOFF_TOKENS / 1_000_000) * writePrice(target) + lostReasoningUsd(session, target);
}

export function labelOf(session: ResumableSession): string {
  return session.pick.modelLabel ?? session.pick.model ?? 'the agent default';
}

export function contextText(tokens: number): string {
  if (tokens < 1_000) return 'under 1K context';
  return `${Math.round(tokens / 1_000)}K context`;
}

function stateOf(session: ResumableSession, now: Date): string {
  return sessionWarm(session, now) ? 'warm' : 'resumable';
}

export function keptText(session: ResumableSession, now: Date): string {
  const context = contextText(session.contextTokens);
  return `kept ${labelOf(session)}: ${stateOf(session, now)} session, ${context}`;
}

export function leftText(reason: string, session: ResumableSession, now: Date): string {
  const context = contextText(session.contextTokens);
  return `${reason}; left the ${stateOf(session, now)} ${labelOf(session)} session (${context})`;
}

export function usd(value: number): string {
  return value >= 0.01 || value === 0 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`;
}
