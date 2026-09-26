import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunMode } from '@spark-outpost/contracts';
import type { StoredSession } from '../providers/provider.ts';

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_OPEN_LIMIT = 8;
export const SESSION_WORKDIR_ROOT = join(tmpdir(), 'spark-outpost-sessions');

export const RESUME_REASONS = {
  settings: 'settings changed',
  moved: 'chat changed since',
  unfinished: 'last turn did not finish',
  idle: 'idle',
  replaced: 'replaced',
} as const;

export interface SessionSettings {
  provider: string;
  model: string | null;
  effort: string | null;
  mode: RunMode | null;
  planning: boolean;
  roots: readonly string[];
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export function settingsHash(settings: SessionSettings): string {
  return sha256(
    JSON.stringify([
      settings.provider,
      settings.model,
      settings.effort,
      settings.mode,
      settings.planning,
      [...settings.roots],
    ]),
  );
}

export function replyHash(text: string): string {
  return sha256(text);
}

export function agentKey(mode: RunMode | null, resumeKey: string | null): string {
  return resumeKey ? `key:${resumeKey}` : `chat:${mode ?? 'chat'}`;
}

export function sessionWorkdir(conversationId: string, key: string): string {
  return join(SESSION_WORKDIR_ROOT, sha256(`${conversationId}\u0000${key}`).slice(0, 24));
}

export interface StoredState {
  sessionId: string;
  cwd: string;
  additionalDirs: readonly string[];
  settingsHash: string;
  lastMessageId: string | null;
  lastReplyHash: string | null;
  lastMessageContent: string | null;
  lastUsedAt: Date;
  closeReason: string | null;
}

export interface DecisionInput {
  stored: StoredState | null;
  hash: string;
  previousMessageId: string | null;
  checksMessages: boolean;
  now: Date;
  idleMs: number;
}

export type ResumeDecision =
  { resume: StoredSession; freshReason: null } | { resume: null; freshReason: string | null };

const fresh = (freshReason: string | null): ResumeDecision => ({ resume: null, freshReason });

function chatMovedOn(input: DecisionInput, stored: StoredState): boolean {
  if (!input.checksMessages) return false;
  if (stored.lastMessageId === null || stored.lastMessageId !== input.previousMessageId) {
    return true;
  }
  return replyHash(stored.lastMessageContent ?? '') !== stored.lastReplyHash;
}

export function decideResume(input: DecisionInput): ResumeDecision {
  const { stored } = input;
  if (!stored) return fresh(null);
  if (stored.closeReason !== null) return fresh(stored.closeReason);
  if (input.now.getTime() - stored.lastUsedAt.getTime() > input.idleMs) {
    return fresh(RESUME_REASONS.idle);
  }
  if (stored.settingsHash !== input.hash) {
    return fresh(RESUME_REASONS.settings);
  }
  if (stored.lastReplyHash === null) {
    return fresh(RESUME_REASONS.unfinished);
  }
  if (chatMovedOn(input, stored)) return fresh(RESUME_REASONS.moved);
  return {
    resume: {
      sessionId: stored.sessionId,
      cwd: stored.cwd,
      additionalDirectories: [...stored.additionalDirs],
    },
    freshReason: null,
  };
}
