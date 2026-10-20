import { rm } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import type { AgentCommand, SessionEvent } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { isCancelRequested } from '../persistence/run-events.ts';
import { runChanges } from '../projects/run-changes.ts';
import {
  closeProviderSession,
  finishProviderSession,
  forgetWorkdir,
  idleWorkdirs,
  latestProviderSession,
  recordReportedCost,
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
import { insertSessionEvent, recordAppliedSettings } from '../persistence/session-events.ts';
import { modelChange, sessionEvent, type SessionFacts } from './session-events.ts';
import { agentDefinitions } from '../agents/acp/agents.ts';
import {
  conversationKey,
  decideConversationResume,
  usesConversationSession,
} from './conversation-session.ts';
import { loadSessionHandoff, missedMessages } from './session-handoff.ts';
import {
  CREW_STOPPED_NOTE,
  RESUME_REASONS,
  STOPPED_NOTE,
  STOPPED_REPLY,
  SESSION_IDLE_MS,
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
  usage(output: UsageOutput): Promise<UsageOutput>;
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
};

const COULD_NOT_REOPEN = "the agent couldn't reopen it";
const PROVIDER_CHANGED = 'the agent changed';

async function usedAnotherProvider(db: Db, conversationId: string, provider: string) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM provider_sessions
     WHERE conversation_id = $1 AND provider <> $2 AND starts_with(agent_key, 'chat:') LIMIT 1`,
    [conversationId, provider],
  );
  return rowCount === 1;
}
const UNKEYED_SETTINGS = { model: null, effort: null, mode: null, planning: false, roots: [] };

function acrossFolders(provider: string): boolean {
  const definitions: Record<string, { resumesAcrossFolders?: boolean } | undefined> =
    agentDefinitions;
  return definitions[provider]?.resumesAcrossFolders === true;
}

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
  const stored = await latestProviderSession(db, conversationId, key);
  const decision = conversation
    ? decideConversationResume({ stored, continuing: input.continuesRunId != null })
    : decideResume({
        stored,
        hash,
        previousMessageId: input.previousMessageId ?? null,
        checksMessages: chatTurn,
        now,
        idleMs: limits.idleMs,
        cwd: chatTurn ? (input.projectRoots[0] ?? null) : null,
        continuing: input.continuesRunId != null,
      });
  const handoffReason = !(conversation && chatTurn)
    ? null
    : decision.resume
      ? COULD_NOT_REOPEN
      : !stored && (await usedAnotherProvider(db, conversationId, input.provider))
        ? PROVIDER_CHANGED
        : null;
  const handoff = handoffReason
    ? await loadSessionHandoff(db, input, handoffReason).catch((error: unknown) => {
        console.error('Could not build the session handoff', error);
        return null;
      })
    : null;
  const missed =
    conversation && stored && decision.resume
      ? await missedMessages(db, input, stored.lastUsedAt, stored.lastReplyHash, key).catch(
          () => [],
        )
      : [];
  const interrupted = input.continuesRunId != null && stored?.lastReplyHash === null;
  const workdir = input.projectRoots.length === 0 ? sessionWorkdir(conversationId, key) : null;
  const commands = decision.resume && stored ? await sessionCommands(db, stored.id) : [];
  const resume = decision.resume && {
    ...decision.resume,
    ...(commands.length > 0 ? { commands: commands.map((command) => command.name) } : {}),
    ...(conversation && acrossFolders(input.provider) ? { anyFolder: true } : {}),
  };
  const followUp =
    decision.resume && decision.stopped
      ? stoppedFollowUp(
          input.followUp ?? input.prompt,
          await stoppedChanges(db, input, chatTurn ? null : resumeKey),
          chatTurn || (await userStopped(db, input, resumeKey)) ? STOPPED_NOTE : CREW_STOPPED_NOTE,
        )
      : input.followUp;
  const facts: SessionFacts = {
    provider: input.provider,
    agentKey: key,
    model: input.settings.model,
    previous: stored,
    seedChars: handoff ? handoff.length + input.prompt.length : seedChars(input),
    handoff: handoff !== null,
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
      freshReason: decision.freshReason ?? (decision.resume ? null : handoffReason),
      ...(followUp ? { followUp } : {}),
      ...(interrupted ? { interrupted } : {}),
      ...(handoff ? { handoff } : {}),
      ...(missed.length > 0 ? { missed } : {}),
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
      if (output.continued && costBaseline > 0) await recordReportedCost(db, rowId, costBaseline);
      await record(sessionEvent(facts, output));
    },
    async settings(output) {
      if (!rowId || !sessionId) return;
      await recordAppliedSettings(db, rowId, output);
      if (continued) await record(modelChange(facts, sessionId, output));
    },
    async commands(commands) {
      if (rowId) await recordSessionCommands(db, rowId, commands);
    },
    async usage(output) {
      context = readingOf(output.contextUsed, output.contextSize) ?? context;
      if (output.costUsd === null) return output;
      if (rowId) await recordReportedCost(db, rowId, output.costUsd);
      if (output.costUsd < costBaseline) costBaseline = 0;
      return { ...output, costUsd: output.costUsd - costBaseline };
    },
    async finished(result) {
      if (!rowId) return;
      if (resumableStop(input, result)) {
        await finishProviderSession(db, rowId, {
          lastMessageId: chatTurn ? result.messageId : null,
          replyHash: STOPPED_REPLY,
          context,
        });
        return;
      }
      if (result.outcome !== 'succeeded' || (chatTurn && !result.messageId && !input.agentCycle)) {
        await closeProviderSession(db, rowId, RESUME_REASONS.unfinished);
        return;
      }
      await noteContext();
      await finishProviderSession(db, rowId, {
        lastMessageId: chatTurn ? result.messageId : null,
        replyHash: replyHash(result.text),
        context,
      });
    },
  };
}

export interface TurnSessionDeps {
  db: Db;
  sessionLimits?: SweepLimits;
}

export function turnSessionFor(deps: TurnSessionDeps, input: RunInput) {
  return prepareTurnSession(deps.db, input, deps.sessionLimits);
}

function seedChars(input: RunInput): number {
  const history = input.seed ? input.history.slice(input.seed.historyFrom) : input.history;
  const sent = history.reduce((chars, turn) => chars + turn.content.length, 0);
  return sent + (input.seed?.text.length ?? 0) + input.prompt.length;
}

function resumableStop(input: RunInput, result: TurnEnd): boolean {
  if (result.outcome !== 'cancelled' || result.stopReason !== 'cancelled') return false;
  return input.parentRunId !== null || result.messageId !== null;
}

async function userStopped(db: Db, input: RunInput, resumeKey: string | null): Promise<boolean> {
  if (!resumeKey) return true;
  const { rows } = await db.query<{ parent: string | null }>(
    `SELECT parent_run_id AS parent FROM runs
     WHERE conversation_id = $1 AND id <> $2 AND route->>'resumeKey' = $3
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [input.identity.threadId, input.identity.runId, resumeKey],
  );
  const parent = rows[0]?.parent ?? null;
  return parent !== null && isCancelRequested(db, parent);
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
  inUse: readonly string[] = [],
): Promise<number> {
  const closed = await sweepProviderSessions(db, limits);
  for (const workdir of await idleWorkdirs(db, limits.idleMs)) {
    if (inUse.includes(workdir)) continue;
    await removeWorkdirs([workdir]);
    await forgetWorkdir(db, workdir);
  }
  return closed;
}
