import type { SessionEvent } from '@spark-outpost/contracts';
import { PROMPT_CACHE_TTL_MS } from '../advisor/policy.ts';
import { HISTORY_BUDGET_BYTES } from '../agents/acp/conversation-prompt.ts';
import { switchCostUsd } from '../orchestration/cache-switch.ts';
import { cardPriceFor } from '../usage/prices.ts';

export const FIRST_SESSION = 'first session';
export const CONTINUED_SESSION = 'continued';
const CHARS_PER_TOKEN = 4;

export interface PreviousSession {
  model: string | null;
  agentMode: string | null;
  contextUsed: number | null;
  lastUsedAt: Date;
  closeReason: string | null;
}

export interface SessionFacts {
  provider: string;
  agentKey: string;
  model: string | null;
  previous: PreviousSession | null;
  seedChars: number;
  handoff: boolean;
  now: Date;
}

export interface OpenedFacts {
  sessionId: string;
  continued: boolean;
  freshReason: string | null;
}

function writeUsd(provider: string, model: string | null, tokens: number | null): number | null {
  const price = cardPriceFor(provider, model?.split('/')[0] ?? null);
  if (!price || tokens === null) return null;
  const perMillion = price.cacheWritePerMillion ?? price.inputPerMillion;
  return Math.round(tokens * perMillion) / 1_000_000;
}

function warm(previous: PreviousSession, now: Date): boolean {
  return now.getTime() - previous.lastUsedAt.getTime() <= PROMPT_CACHE_TTL_MS;
}

function seedTokens(chars: number): number {
  return Math.ceil(Math.min(chars, HISTORY_BUDGET_BYTES) / CHARS_PER_TOKEN);
}

export function sessionEvent(facts: SessionFacts, opened: OpenedFacts): SessionEvent {
  const { previous } = facts;
  const base = {
    kept: true,
    harness: 'simple' as const,
    provider: facts.provider,
    agentKey: facts.agentKey,
    sessionId: opened.sessionId,
    model: facts.model,
  };
  if (opened.continued && previous) {
    const carried = previous.contextUsed;
    return {
      ...base,
      event: 'resume',
      reason: CONTINUED_SESSION,
      carriedTokens: carried,
      cacheWriteUsd: warm(previous, facts.now) ? 0 : writeUsd(facts.provider, facts.model, carried),
    };
  }
  const carried = seedTokens(facts.seedChars);
  return {
    ...base,
    event: previous ? 'replace' : 'open',
    reason: opened.freshReason ?? previous?.closeReason ?? (previous ? 'replaced' : FIRST_SESSION),
    carriedTokens: carried,
    cacheWriteUsd: writeUsd(facts.provider, facts.model, carried),
    ...(facts.handoff ? { handoff: true } : {}),
  };
}

export interface AppliedSettings {
  model: string | null;
  mode: string | null;
}

export function modelChange(
  facts: SessionFacts,
  sessionId: string,
  applied: AppliedSettings,
): SessionEvent | null {
  const { previous } = facts;
  if (!previous?.model || !applied.model || previous.model === applied.model) return null;
  const cost = switchCostUsd(
    {
      pick: { provider: facts.provider, model: previous.model, modelLabel: null, effort: null },
      contextTokens: previous.contextUsed ?? 0,
      lastUsedAt: previous.lastUsedAt,
    },
    { id: applied.model, label: '' },
    facts.now,
  );
  return {
    event: 'model_change',
    reason: 'model changed on the same session',
    kept: true,
    harness: 'simple' as const,
    provider: facts.provider,
    agentKey: facts.agentKey,
    sessionId,
    model: applied.model,
    fromModel: previous.model,
    mode: applied.mode,
    fromMode: previous.agentMode,
    carriedTokens: previous.contextUsed,
    cacheWriteUsd: cost,
  };
}
