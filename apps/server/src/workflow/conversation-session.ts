import { SESSION_CLOSE_REASONS } from '../persistence/provider-sessions.ts';
import type { StoredSession } from '../providers/provider.ts';
import { STOPPED_REPLY, type ResumeDecision } from './session-decision.ts';

export const CONVERSATION_KEY_PREFIX = 'chat:';

const CLOSED_BY_THE_USER = new Set<string>([
  SESSION_CLOSE_REASONS.fresh,
  SESSION_CLOSE_REASONS.compacted,
  SESSION_CLOSE_REASONS.movedToFreshChat,
  SESSION_CLOSE_REASONS.archived,
]);

export interface ConversationCandidate {
  parentRunId: string | null;
}

export function usesConversationSession(input: ConversationCandidate): boolean {
  return input.parentRunId === null;
}

export function conversationKey(provider: string): string {
  return `${CONVERSATION_KEY_PREFIX}${provider}`;
}

export interface ConversationStored {
  sessionId: string;
  cwd: string;
  additionalDirs: readonly string[];
  lastReplyHash: string | null;
  closeReason: string | null;
}

export interface ConversationDecisionInput {
  stored: ConversationStored | null;
  continuing: boolean;
}

const fresh = (freshReason: string | null): ResumeDecision => ({ resume: null, freshReason });

export function decideConversationResume(input: ConversationDecisionInput): ResumeDecision {
  const { stored } = input;
  if (!stored) return fresh(null);
  if (stored.closeReason !== null && CLOSED_BY_THE_USER.has(stored.closeReason)) {
    return fresh(stored.closeReason);
  }
  const resume: StoredSession = {
    sessionId: stored.sessionId,
    cwd: stored.cwd,
    additionalDirectories: [...stored.additionalDirs],
  };
  if (stored.lastReplyHash === null && input.continuing) {
    return { resume, freshReason: null, interrupted: true };
  }
  if (stored.lastReplyHash === STOPPED_REPLY) return { resume, freshReason: null, stopped: true };
  return { resume, freshReason: null };
}
