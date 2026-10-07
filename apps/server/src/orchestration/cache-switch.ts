import type { AgentPick, ModelCard } from '@spark-outpost/contracts';
import {
  HANDOFF_TOKENS,
  LOST_REASONING_CAP_TOKENS,
  PROMPT_CACHE_TTL_MS,
} from '../advisor/policy.ts';
import { scoringCard, type TierModel } from './tiers.ts';

export interface ResumableSession {
  pick: AgentPick;
  contextTokens: number;
  lastUsedAt?: Date | null;
  reasoningTokens?: number | null;
}

export interface SessionChoice {
  kept: boolean;
  reason: string;
  session: AgentPick;
}

type Price = NonNullable<ModelCard['price']>;

function sessionCard(session: ResumableSession): ModelCard | null {
  const { model, modelLabel, provider } = session.pick;
  return scoringCard({ id: model ?? '', label: modelLabel ?? '' }, provider);
}

export function sessionWarm(session: ResumableSession, now: Date): boolean {
  const last = session.lastUsedAt;
  return (
    last !== null && last !== undefined && now.getTime() - last.getTime() <= PROMPT_CACHE_TTL_MS
  );
}

function writePrice(price: Price): number {
  return price.cacheWritePerMillion ?? price.inputPerMillion;
}

function lostReasoningUsd(session: ResumableSession, target: Price): number {
  const tokens = Math.min(session.reasoningTokens ?? 0, LOST_REASONING_CAP_TOKENS);
  return (tokens / 1_000_000) * target.outputPerMillion;
}

export function switchCostUsd(session: ResumableSession, to: TierModel, now: Date): number | null {
  if (to.id === session.pick.model) return 0;
  const from = sessionCard(session)?.price;
  const target = scoringCard(to, session.pick.provider)?.price;
  if (!from || !target) return null;
  const millions = session.contextTokens / 1_000_000;
  const stay =
    millions * (sessionWarm(session, now) ? from.cachedInputPerMillion : writePrice(from));
  return Math.max(0, millions * writePrice(target) - stay) + lostReasoningUsd(session, target);
}

export function handoffCostUsd(session: ResumableSession, to: TierModel): number | null {
  if (to.id === session.pick.model) return 0;
  const target = scoringCard(to, session.pick.provider)?.price;
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
