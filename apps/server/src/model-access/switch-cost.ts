import type { AgentPick, ModelCard } from '@spark-outpost/contracts';
import { LOST_REASONING_CAP_TOKENS, PROMPT_CACHE_TTL_MS } from '../advisor/policy.ts';
import { cardFor } from '../model-cards/cards.ts';
import type { TierModel } from './tiers.ts';

export interface ResumableSession {
  pick: AgentPick;
  contextTokens: number;
  lastUsedAt?: Date | null;
  reasoningTokens?: number | null;
}

type Price = NonNullable<ModelCard['price']>;

function sessionCard(session: ResumableSession): ModelCard | null {
  const { model, modelLabel, provider } = session.pick;
  return cardFor({ id: model ?? '', label: modelLabel ?? '' }, provider);
}

export function sessionWarm(session: ResumableSession, now: Date): boolean {
  const last = session.lastUsedAt;
  return (
    last !== null && last !== undefined && now.getTime() - last.getTime() <= PROMPT_CACHE_TTL_MS
  );
}

export function writePrice(price: Price): number {
  return price.cacheWritePerMillion ?? price.inputPerMillion;
}

export function lostReasoningUsd(session: ResumableSession, target: Price): number {
  const tokens = Math.min(session.reasoningTokens ?? 0, LOST_REASONING_CAP_TOKENS);
  return (tokens / 1_000_000) * target.outputPerMillion;
}

export function switchCostUsd(session: ResumableSession, to: TierModel, now: Date): number | null {
  if (to.id === session.pick.model) return 0;
  const from = sessionCard(session)?.price;
  const target = cardFor(to, session.pick.provider)?.price;
  if (!from || !target) return null;
  const millions = session.contextTokens / 1_000_000;
  const stay =
    millions * (sessionWarm(session, now) ? from.cachedInputPerMillion : writePrice(from));
  return Math.max(0, millions * writePrice(target) - stay) + lostReasoningUsd(session, target);
}
