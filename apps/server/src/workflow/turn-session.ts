import { rm } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import type { AgentCommand, HarnessSetting, SessionEvent } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { isCancelRequested } from '../persistence/run-events.ts';
import { runChanges } from '../projects/run-changes.ts';
import {
  closeProviderSession,
  evictBeyondLimit,
  finishProviderSession,
  forgetWorkdir,
  idleWorkdirs,
  latestProviderSession,
  startProviderSession,
  sweepProviderSessions,
  type ContextReading,
  type SweepLimits,
} from '../persistence/provider-sessions.ts';
import { insertCompaction, settleTokensAfter } from '../persistence/compactions.ts';
import { readingOf, selfCompacted } from '../compaction/policy.ts';
import { recordSessionCommands, sessionCommands } from '../persistence/session-commands.ts';
import type { ProviderOutput, SessionTarget } from '../providers/provider.ts';
import type { StopReason } from './agent-turn.ts';
import { plansThisTurn } from '../plans/plan-mode.ts';
import type { RunInput } from './run-input.ts';
import { harnessSetting } from '../harness/setting.ts';
import { insertSessionEvent, recordAppliedSettings } from '../persistence/session-events.ts';
import { modelChange, sessionEvent, type SessionFacts } from './session-events.ts';
import {
  RESUME_REASONS,
  STOPPED_REPLY,
  SESSION_IDLE_MS,
  SESSION_OPEN_LIMIT,
  SESSION_WORKDIR_ROOT,
  agentKey,
  decideResume,
  replyHash,
  sessionWorkdir,
  settingsHash,
  stoppedFollowUp,
} from './session-decision.ts';

export type SessionOutput = Extract<ProviderOutput, { kind: 'session' }>;
type UsageOutput = Extract<ProviderOutput, { kind: 'usage' }>;
type SettingsOutput = Extract<ProviderOutput, { kind: 'session_settings' }>;

export interface TurnSession {
  target: SessionTarget;
  started(output: SessionOutput): Promise<void>;
  commands(commands: readonly AgentCommand[]): Promise<void>;
  settings(output: SettingsOutput): Promise<void>;
  noteSession(output: SessionOutput): void;
  usage(output: UsageOutput): UsageOutput;
  finished(result: TurnEnd): Promise<void>;
}

export interface TurnEnd {
  outcome: string;
  messageId: string | null;
  text: string;
  stopReason?: StopReason | null;
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
  harness: HarnessSetting = harnessSetting(),
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
    planning: plansThisTurn(input),
    roots: input.projectRoots,
    keyed: !chatTurn,
  });
  const stored = await latestProviderSession(db, conversationId, key);
  const decision = decideResume({
    stored,
    hash,
    previousMessageId: input.previousMessageId ?? null,
    checksMessages: chatTurn,
    now,
    idleMs: limits.idleMs,
    cwd: chatTurn ? (input.projectRoots[0] ?? null) : null,
    continuing: input.continuesRunId != null,
  });
  const interrupted = input.continuesRunId != null && stored?.lastReplyHash === null;
  const workdir = input.projectRoots.length === 0 ? sessionWorkdir(conversationId, key) : null;
  const commands = decision.resume && stored ? await sessionCommands(db, stored.id) : [];
  const resume =
    decision.resume && commands.length > 0
      ? { ...decision.resume, commands: commands.map((command) => command.name) }
      : decision.resume;
  const followUp =
    decision.resume && decision.stopped
      ? stoppedFollowUp(
          input.followUp ?? input.prompt,
          await stoppedChanges(db, input, chatTurn ? null : resumeKey),
        )
      : input.followUp;
  const facts: SessionFacts = {
    harness,
    provider: input.provider,
    agentKey: key,
    model: input.settings.model,
    previous: stored,
    seedChars: seedChars(input),
    handoff: false,
    now,
  };
  const record = (event: SessionEvent | null) =>
    event
      ? insertSessionEvent(db, {
          conversationId,
          sessionRowId: rowId,
          runId: input.identity.runId,
          event,
        }).catch((error: unknown) => console.error('Could not record a session event', error))
      : Promise.resolve();
  let sessionId: string | null = null;
  let rowId: string | null = null;
  let costBaseline = 0;
  let reportedCost: number | null = null;
  let continued = false;
  let context: ContextReading | null = null;
  const previous = stored ? readingOf(stored.contextUsed, stored.contextSize) : null;
  const noteSession = (output: SessionOutput) => {
    continued = output.continued;
    costBaseline = output.continued ? (stored?.reportedCostUsd ?? 0) : 0;
  };
  const noteContext = async () => {
    if (!context) return;
    const ownerRunId = input.parentRunId ?? input.identity.runId;
    await settleTokensAfter(db, ownerRunId, context.used);
    if (!continued || rowId !== stored?.id || !selfCompacted(previous, context)) return;
    await insertCompaction(db, {
      conversationId,
      runId: ownerRunId,
      sessionRowId: rowId,
      agentKey: key,
      method: 'agent-auto',
      tokensBefore: previous?.used ?? null,
      tokensAfter: context.used,
      contextSize: context.size,
      summary: null,
      lastMessageId: null,
    });
  };
  return {
    target: {
      workdir,
      resume,
      freshReason: decision.freshReason,
      ...(followUp ? { followUp } : {}),
      ...(interrupted ? { interrupted } : {}),
    },
    noteSession,
    async started(output) {
      noteSession(output);
      sessionId = output.sessionId;
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
      await record(sessionEvent(facts, output));
      await evictBeyondLimit(db, limits.openLimit);
    },
    async settings(output) {
      if (!rowId || !sessionId) return;
      await recordAppliedSettings(db, rowId, output);
      if (continued) await record(modelChange(facts, sessionId, output));
    },
    async commands(commands) {
      if (rowId) await recordSessionCommands(db, rowId, commands);
    },
    usage(output) {
      context = readingOf(output.contextUsed, output.contextSize) ?? context;
      if (output.costUsd === null) return output;
      reportedCost = output.costUsd;
      return { ...output, costUsd: Math.max(0, output.costUsd - costBaseline) };
    },
    async finished(result) {
      if (!rowId) return;
      if (await resumableStop(db, input, result)) {
        await finishProviderSession(db, rowId, {
          lastMessageId: chatTurn ? result.messageId : null,
          replyHash: STOPPED_REPLY,
          reportedCostUsd: reportedCost,
          context,
        });
        return;
      }
      if (result.outcome !== 'succeeded' || (chatTurn && !result.messageId)) {
        await closeProviderSession(db, rowId, RESUME_REASONS.unfinished);
        return;
      }
      await noteContext();
      await finishProviderSession(db, rowId, {
        lastMessageId: chatTurn ? result.messageId : null,
        replyHash: replyHash(result.text),
        reportedCostUsd: reportedCost,
        context,
      });
    },
  };
}

export interface TurnSessionDeps {
  db: Db;
  sessionLimits?: SweepLimits;
  harness?: HarnessSetting;
}

export function turnSessionFor(deps: TurnSessionDeps, input: RunInput) {
  return prepareTurnSession(deps.db, input, deps.sessionLimits, undefined, deps.harness);
}

function seedChars(input: RunInput): number {
  const history = input.seed ? input.history.slice(input.seed.historyFrom) : input.history;
  const sent = history.reduce((chars, turn) => chars + turn.content.length, 0);
  return sent + (input.seed?.text.length ?? 0) + input.prompt.length;
}

async function resumableStop(db: Db, input: RunInput, result: TurnEnd): Promise<boolean> {
  if (result.outcome !== 'cancelled' || result.stopReason !== 'cancelled') return false;
  if (input.parentRunId === null) return result.messageId !== null;
  return isCancelRequested(db, input.parentRunId);
}

async function stoppedChanges(
  db: Db,
  input: RunInput,
  resumeKey: string | null,
): Promise<string[]> {
  const scope = resumeKey ? "route->>'resumeKey' = $3" : 'parent_run_id IS NULL';
  const { rows } = await db.query<{ owner: string; status: string }>(
    `SELECT COALESCE(parent_run_id, id) AS owner, status FROM runs
     WHERE conversation_id = $1 AND id <> $2 AND ${scope}
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [input.identity.threadId, input.identity.runId, ...(resumeKey ? [resumeKey] : [])],
  );
  const stopped = rows[0];
  if (stopped?.status !== 'cancelled') return [];
  const changes = await runChanges(db, input.workspaceId, stopped.owner, true).catch(() => null);
  return changes?.files.map((file) => file.path) ?? [];
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
