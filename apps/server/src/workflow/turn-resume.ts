import type { Db } from '../persistence/db.ts';
import {
  latestProviderSession,
  type ProviderSessionRecord,
} from '../persistence/provider-sessions.ts';
import { plansThisTurn } from '../plans/plan-mode.ts';
import {
  conversationKey,
  decideConversationResume,
  usesConversationSession,
} from './conversation-session.ts';
import type { RunInput } from './run-input.ts';
import { agentKey, decideResume, settingsHash, type ResumeDecision } from './session-decision.ts';

const UNKEYED_SETTINGS = { model: null, effort: null, mode: null, planning: false, roots: [] };

export interface TurnResume {
  conversation: boolean;
  key: string;
  hash: string;
  stored: ProviderSessionRecord | null;
  decision: ResumeDecision;
}

export async function turnResume(
  db: Db,
  input: RunInput,
  idleMs: number,
  now: Date,
): Promise<TurnResume> {
  const chatTurn = input.parentRunId === null;
  const resumeKey = input.resumeKey ?? null;
  const conversation = usesConversationSession(input);
  const key = conversation
    ? conversationKey(input.provider)
    : agentKey(input.mode, chatTurn ? null : resumeKey);
  const hash = settingsHash(
    conversation
      ? { provider: input.provider, ...UNKEYED_SETTINGS }
      : {
          provider: input.provider,
          model: input.settings.model,
          effort: input.settings.effort,
          mode: input.mode,
          planning: plansThisTurn(input),
          roots: input.projectRoots,
          keyed: !chatTurn,
        },
  );
  const stored = await latestProviderSession(db, input.identity.threadId, key);
  const decision = conversation
    ? decideConversationResume({ stored, continuing: input.continuesRunId != null })
    : decideResume({
        stored,
        hash,
        previousMessageId: input.previousMessageId ?? null,
        checksMessages: chatTurn,
        now,
        idleMs,
        cwd: chatTurn ? (input.projectRoots[0] ?? null) : null,
        continuing: input.continuesRunId != null,
      });
  return { conversation, key, hash, stored, decision };
}
