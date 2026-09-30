import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunMode } from '@spark-outpost/contracts';
import { effortKeepsCache } from '../model-cards/cards.ts';
import type { StoredSession } from '../providers/provider.ts';

export const SESSION_IDLE_MS = 4 * 60 * 60 * 1000;
export const SESSION_OPEN_LIMIT = 16;
export const SESSION_WORKDIR_ROOT = join(tmpdir(), 'spark-outpost-sessions');

export const RESUME_REASONS = {
  settings: 'settings changed',
  project: 'project changed',
  moved: 'chat changed since',
  unfinished: 'last turn did not finish',
  idle: 'idle',
  replaced: 'replaced',
} as const;

export const STOPPED_REPLY = 'stopped by the user';

export const STOPPED_NOTE =
  'You were stopped by the user before your last turn finished; continue where you left off. ' +
  'Your edits so far are still in place: check them instead of redoing that work.';

export interface SessionSettings {
  provider: string;
  model: string | null;
  effort: string | null;
  mode: RunMode | null;
  planning: boolean;
  roots: readonly string[];
  keyed?: boolean;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function hashedEffort(settings: SessionSettings): string | null {
  if (!settings.keyed || settings.model === null) return settings.effort;
  return effortKeepsCache({ id: settings.model }, settings.provider) ? null : settings.effort;
}

export function settingsHash(settings: SessionSettings): string {
  return sha256(
    JSON.stringify([
      settings.provider,
      settings.model,
      hashedEffort(settings),
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
  cwd?: string | null;
}

export type ResumeDecision =
  | { resume: StoredSession; freshReason: null; stopped?: true }
  | { resume: null; freshReason: string | null };

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
    const moved = input.cwd && input.cwd !== stored.cwd;
    return fresh(moved ? RESUME_REASONS.project : RESUME_REASONS.settings);
  }
  if (stored.lastReplyHash === null) {
    return fresh(RESUME_REASONS.unfinished);
  }
  const resume: StoredSession = {
    sessionId: stored.sessionId,
    cwd: stored.cwd,
    additionalDirectories: [...stored.additionalDirs],
  };
  if (stored.lastReplyHash === STOPPED_REPLY) {
    if (!input.checksMessages) return { resume, freshReason: null, stopped: true };
    if (stored.lastMessageId === null) return fresh(RESUME_REASONS.unfinished);
    if (stored.lastMessageId !== input.previousMessageId) return fresh(RESUME_REASONS.moved);
    return { resume, freshReason: null, stopped: true };
  }
  if (chatMovedOn(input, stored)) return fresh(RESUME_REASONS.moved);
  return { resume, freshReason: null };
}

const STOPPED_FILES_SHOWN = 20;

export function stoppedFollowUp(message: string, changed: readonly string[]): string {
  const shown = changed.slice(0, STOPPED_FILES_SHOWN).map((path) => `\`${path}\``);
  const more = changed.length - shown.length;
  if (more > 0) shown.push(`and ${more} more`);
  const files = shown.length > 0 ? `\nFiles changed before the stop: ${shown.join(', ')}.` : '';
  return `${STOPPED_NOTE}${files}\n\n${message}`;
}
