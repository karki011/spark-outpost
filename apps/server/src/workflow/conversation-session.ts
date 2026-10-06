import { HANDOFF_CONTEXT_TOKENS, HANDOFF_TOKENS, PROMPT_CACHE_TTL_MS } from '../advisor/policy.ts';
import type { StoredSession } from '../providers/provider.ts';
import { cardPriceFor } from '../usage/prices.ts';
import { RESUME_REASONS, STOPPED_REPLY, type ResumeDecision } from './session-decision.ts';

export const CONVERSATION_KEY_PREFIX = 'chat:';
export const FRESH_IS_CHEAPER = 'a fresh start is cheaper than re-reading';

const SOLO_BUILDER_KEY = /:builder$/;
const KEEPS_CLOSED = new Set<string>([RESUME_REASONS.idle, 'too many open sessions']);

export interface ConversationCandidate {
  parentRunId: string | null;
  role: string | null;
  resumeKey?: string | null;
  piece?: unknown;
}

export function usesConversationSession(input: ConversationCandidate): boolean {
  if (input.parentRunId === null) return true;
  return (
    input.role === 'builder' &&
    !input.piece &&
    typeof input.resumeKey === 'string' &&
    SOLO_BUILDER_KEY.test(input.resumeKey)
  );
}

export function conversationKey(provider: string): string {
  return `${CONVERSATION_KEY_PREFIX}${provider}`;
}

export interface ConversationStored {
  sessionId: string;
  cwd: string;
  additionalDirs: readonly string[];
  lastReplyHash: string | null;
  lastUsedAt: Date;
  closeReason: string | null;
  contextUsed: number | null;
  model: string | null;
}

export interface ConversationDecisionInput {
  stored: ConversationStored | null;
  provider: string;
  model: string | null;
  now: Date;
  continuing: boolean;
}

export function freshIsCheaper(
  stored: Pick<ConversationStored, 'contextUsed' | 'lastUsedAt' | 'model'>,
  provider: string,
  model: string | null,
  now: Date,
): boolean {
  const context = stored.contextUsed ?? 0;
  if (context < HANDOFF_CONTEXT_TOKENS) return false;
  if (now.getTime() - stored.lastUsedAt.getTime() <= PROMPT_CACHE_TTL_MS) return false;
  const reread = writePrice(provider, stored.model ?? model);
  const restart = writePrice(provider, model ?? stored.model);
  if (reread === null || restart === null) return false;
  return HANDOFF_TOKENS * restart < context * reread;
}

function writePrice(provider: string, model: string | null): number | null {
  const price = cardPriceFor(provider, model?.split('/')[0] ?? null);
  return price ? (price.cacheWritePerMillion ?? price.inputPerMillion) : null;
}

const fresh = (freshReason: string | null): ResumeDecision => ({ resume: null, freshReason });

export function decideConversationResume(input: ConversationDecisionInput): ResumeDecision {
  const { stored } = input;
  if (!stored) return fresh(null);
  const interrupted = input.continuing && stored.lastReplyHash === null;
  const unfinished = stored.closeReason === RESUME_REASONS.unfinished;
  if (stored.closeReason !== null && !KEEPS_CLOSED.has(stored.closeReason)) {
    if (!(interrupted && unfinished)) return fresh(stored.closeReason);
  }
  const resume: StoredSession = {
    sessionId: stored.sessionId,
    cwd: stored.cwd,
    additionalDirectories: [...stored.additionalDirs],
  };
  if (stored.lastReplyHash === null) {
    return interrupted
      ? { resume, freshReason: null, interrupted: true }
      : fresh(RESUME_REASONS.unfinished);
  }
  if (stored.lastReplyHash === STOPPED_REPLY) return { resume, freshReason: null, stopped: true };
  if (freshIsCheaper(stored, input.provider, input.model, input.now)) {
    return fresh(FRESH_IS_CHEAPER);
  }
  return { resume, freshReason: null };
}
