import { rm } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import type { AgentCommand } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  closeProviderSession,
  evictBeyondLimit,
  finishProviderSession,
  forgetWorkdir,
  idleWorkdirs,
  latestProviderSession,
  startProviderSession,
  sweepProviderSessions,
  type SweepLimits,
} from '../persistence/provider-sessions.ts';
import { recordSessionCommands, sessionCommands } from '../persistence/session-commands.ts';
import type { ProviderOutput, SessionTarget } from '../providers/provider.ts';
import type { RunInput } from './run-input.ts';
import {
  RESUME_REASONS,
  SESSION_IDLE_MS,
  SESSION_OPEN_LIMIT,
  SESSION_WORKDIR_ROOT,
  agentKey,
  decideResume,
  replyHash,
  sessionWorkdir,
  settingsHash,
} from './session-decision.ts';

export type SessionOutput = Extract<ProviderOutput, { kind: 'session' }>;
type UsageOutput = Extract<ProviderOutput, { kind: 'usage' }>;

export interface TurnSession {
  target: SessionTarget;
  started(output: SessionOutput): Promise<void>;
  commands(commands: readonly AgentCommand[]): Promise<void>;
  usage(output: UsageOutput): UsageOutput;
  finished(result: { outcome: string; messageId: string | null; text: string }): Promise<void>;
}

export const DEFAULT_SWEEP_LIMITS: SweepLimits = {
  idleMs: SESSION_IDLE_MS,
  openLimit: SESSION_OPEN_LIMIT,
};

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;
}

export async function prepareTurnSession(
  db: Db,
  input: RunInput,
  limits: SweepLimits = DEFAULT_SWEEP_LIMITS,
  now = new Date(),
): Promise<TurnSession | null> {
  const chatTurn = input.parentRunId === null;
  const resumeKey = input.resumeKey ?? null;
  if (!chatTurn && !resumeKey) return null;
  const conversationId = input.identity.threadId;
  const key = agentKey(input.mode, chatTurn ? null : resumeKey);
  const hash = settingsHash({
    provider: input.provider,
    model: input.settings.model,
    effort: input.settings.effort,
    mode: input.mode,
    planning: false,
    roots: input.projectRoots,
  });
  const stored = await latestProviderSession(db, conversationId, key);
  const decision = decideResume({
    stored,
    hash,
    previousMessageId: input.previousMessageId ?? null,
    checksMessages: chatTurn,
    now,
    idleMs: limits.idleMs,
  });
  const workdir = input.projectRoots.length === 0 ? sessionWorkdir(conversationId, key) : null;
  const commands = decision.resume && stored ? await sessionCommands(db, stored.id) : [];
  const resume =
    decision.resume && commands.length > 0
      ? { ...decision.resume, commands: commands.map((command) => command.name) }
      : decision.resume;
  let rowId: string | null = null;
  let costBaseline = 0;
  let reportedCost: number | null = null;
  return {
    target: {
      workdir,
      resume,
      freshReason: decision.freshReason,
      ...(input.followUp ? { followUp: input.followUp } : {}),
    },
    async started(output) {
      costBaseline = output.continued ? (stored?.reportedCostUsd ?? 0) : 0;
      try {
        rowId = await startProviderSession(db, {
          conversationId,
          provider: input.provider,
          agentKey: key,
          sessionId: output.sessionId,
          cwd: output.cwd,
          workdir,
          additionalDirs: output.additionalDirectories,
          settingsHash: hash,
          replacedReason: output.freshReason ?? RESUME_REASONS.replaced,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return;
      }
      if (!rowId) return;
      await evictBeyondLimit(db, limits.openLimit);
    },
    async commands(commands) {
      if (rowId) await recordSessionCommands(db, rowId, commands);
    },
    usage(output) {
      if (output.costUsd === null) return output;
      reportedCost = output.costUsd;
      return { ...output, costUsd: Math.max(0, output.costUsd - costBaseline) };
    },
    async finished(result) {
      if (!rowId) return;
      if (result.outcome !== 'succeeded' || (chatTurn && !result.messageId)) {
        await closeProviderSession(db, rowId, RESUME_REASONS.unfinished);
        return;
      }
      await finishProviderSession(db, rowId, {
        lastMessageId: chatTurn ? result.messageId : null,
        replyHash: replyHash(result.text),
        reportedCostUsd: reportedCost,
      });
    },
  };
}

function insideWorkdirRoot(path: string): boolean {
  const inside = relative(SESSION_WORKDIR_ROOT, path);
  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside);
}

export async function removeWorkdirs(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    if (insideWorkdirRoot(path)) await rm(path, { recursive: true, force: true });
  }
}

export async function sweepSessions(
  db: Db,
  limits: SweepLimits = DEFAULT_SWEEP_LIMITS,
): Promise<number> {
  const closed = await sweepProviderSessions(db, limits);
  for (const workdir of await idleWorkdirs(db, limits.idleMs)) {
    await removeWorkdirs([workdir]);
    await forgetWorkdir(db, workdir);
  }
  return closed;
}
