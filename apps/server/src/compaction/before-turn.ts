import {
  CHECKPOINT_OPTION,
  reaskPercent,
  type CompactionThresholds,
  type RunMode,
} from '@spark-outpost/contracts';
import { recordAssistantEvent } from '../companion/assistant-events.ts';
import { insertCompaction, pendingCardInChat } from '../persistence/compactions.ts';
import type { Lease } from '../persistence/jobs.ts';
import {
  SESSION_CLOSE_REASONS,
  closeKeyedSessions,
  openChatSessions,
  recordCompacted,
  snoozeCompaction,
  type ContextReading,
  type ProviderSessionRecord,
} from '../persistence/provider-sessions.ts';
import { sessionCommands } from '../persistence/session-commands.ts';
import { autoContinueSeconds, compactionThresholds } from '../persistence/setup.ts';
import { askCheckpoint, compactCard } from '../workflow/kept-record.ts';
import { kilo } from '../agents/acp/long-context.ts';
import type { Append, RunControl, TurnDeps } from '../workflow/agent-turn.ts';
import { APPROVAL_POLL_MS, APPROVAL_TIMEOUT_MS } from '../workflow/approval-gate.ts';
import { startsWithCommand, withAgentNote } from '../workflow/agent-note.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { SESSION_IDLE_MS, decideResume } from '../workflow/session-decision.ts';
import { HISTORY_TOOL_NOTE } from '../workflow/session-brief.ts';
import { compactInSession, leaseLog, offersCompact, type CompactTarget } from './agent-compact.ts';
import { startFreshChat, type FreshChat } from './fresh-chat.ts';
import { chatIdentifiers } from './identifiers.ts';
import { agentCompactWorked, compactStep, readingOf, usedPercent } from './policy.ts';
import { buildChatSummary } from './summary.ts';

export interface BeforeTurnDeps extends TurnDeps {
  checkpointTimeoutMs?: number;
}

export type BeforeTurn =
  { kind: 'continue'; input: RunInput } | { kind: 'moved'; chat: FreshChat } | { kind: 'stopped' };

interface Candidate extends CompactTarget {
  reading: ContextReading;
}

export const AGENT_COMPACTED_NOTE = `Your context was just compacted with /compact. ${HISTORY_TOOL_NOTE}`;

function modeOf(agentKey: string): RunMode | null {
  const mode = agentKey.slice('chat:'.length);
  return mode === 'ask' || mode === 'do' || mode === 'chat' ? mode : null;
}

function resumes(
  session: ProviderSessionRecord,
  input: RunInput,
  idleMs: number,
  now: Date,
): boolean {
  return (
    decideResume({
      stored: session,
      hash: session.settingsHash,
      previousMessageId: input.previousMessageId ?? null,
      checksMessages: true,
      now,
      idleMs,
    }).resume !== null
  );
}

async function lastPick(deps: TurnDeps, input: RunInput, session: ProviderSessionRecord) {
  const { rows } = await deps.db.query<{ model: string | null; effort: string | null }>(
    'SELECT r.model, r.effort FROM messages m JOIN runs r ON r.id = m.run_id WHERE m.id = $1',
    [session.lastMessageId],
  );
  return {
    model: rows[0]?.model ?? input.settings.model,
    effort: rows[0]?.effort ?? input.settings.effort,
  };
}

async function candidateFor(deps: TurnDeps, input: RunInput): Promise<Candidate | null> {
  const idleMs = deps.sessionLimits?.idleMs ?? SESSION_IDLE_MS;
  const now = new Date();
  const sessions = await openChatSessions(deps.db, input.identity.threadId);
  let best: { session: ProviderSessionRecord; reading: ContextReading } | null = null;
  for (const session of sessions) {
    const reading = readingOf(session.contextUsed, session.contextSize);
    if (!reading || session.provider !== input.provider) continue;
    if (!resumes(session, input, idleMs, now)) continue;
    if (!best || usedPercent(reading) > usedPercent(best.reading)) best = { session, reading };
  }
  if (!best) return null;
  const commands = await sessionCommands(deps.db, best.session.id);
  return {
    ...best,
    mode: modeOf(best.session.agentKey),
    commands: commands.map((command) => command.name),
    ...(await lastPick(deps, input, best.session)),
  };
}

function cardReason(reading: ContextReading, thresholds: CompactionThresholds): string {
  const full = `The agent's context is ${usedPercent(reading)}% full (${kilo(reading.used)} of ${kilo(reading.size)} tokens).`;
  const keeps =
    'Compacting keeps the full transcript in Spark; the agent carries on from a summary.';
  const manual = thresholds.autoCompact ? '' : ' Automatic compaction is off, so Spark asks first.';
  return `${full} ${keeps}${manual}`;
}

async function notice(append: Append, text: string): Promise<void> {
  await append(runEvents.stepStarted(text));
  await append(runEvents.stepFinished(text));
}

async function askFirst(
  deps: BeforeTurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: Pick<RunControl, 'signal'>,
  reading: ContextReading,
  thresholds: CompactionThresholds,
) {
  const seconds = await autoContinueSeconds(deps.db, input.workspaceId);
  return askCheckpoint(
    {
      db: deps.db,
      runId: lease.runId,
      append,
      waiters: deps.approvalWaiters ?? new ApprovalWaiters(),
      signal: control.signal,
      timeoutMs: deps.checkpointTimeoutMs ?? deps.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS,
      pollMs: deps.approvalPollMs ?? APPROVAL_POLL_MS,
      autoContinueMs: seconds === null ? null : seconds * 1000,
    },
    compactCard(cardReason(reading, thresholds), reaskPercent(thresholds.compactPercent)),
    1,
  );
}

function compactedNote(identifiers: string): string {
  return [AGENT_COMPACTED_NOTE, identifiers].filter(Boolean).join('\n\n');
}

function withIdentifiers(summary: string, identifiers: string): string | null {
  return [summary, identifiers].filter(Boolean).join('\n\n') || null;
}

async function compactWithAgent(
  deps: TurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: Pick<RunControl, 'signal'>,
  candidate: Candidate,
): Promise<RunInput | null> {
  if (!offersCompact(candidate.commands)) return null;
  await notice(append, `Sent /compact to the agent (${kilo(candidate.reading.used)} tokens)`);
  const compacted = await compactInSession(
    deps,
    leaseLog(deps, lease),
    input,
    candidate,
    append,
    control.signal,
  );
  if (!compacted || !agentCompactWorked(candidate.reading, compacted.after)) return null;
  const { after } = compacted;
  const identifiers = startsWithCommand(input) ? '' : await chatIdentifiers(deps.db, input);
  await recordCompacted(deps.db, candidate.session.id, after);
  await insertCompaction(deps.db, {
    conversationId: input.identity.threadId,
    runId: lease.runId,
    sessionRowId: candidate.session.id,
    agentKey: candidate.session.agentKey,
    method: 'agent',
    tokensBefore: candidate.reading.used,
    tokensAfter: null,
    contextSize: after.size,
    summary: withIdentifiers(compacted.text, identifiers),
    lastMessageId: input.previousMessageId ?? null,
  });
  await notice(
    append,
    `Compacted the chat: ${kilo(candidate.reading.used)} tokens → a ~${kilo(after.used)} summary; the size with the system prompt and tools shows after the next reply`,
  );
  return withAgentNote(input, compactedNote(identifiers));
}

async function compactWithSpark(
  deps: TurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  candidate: Candidate,
): Promise<RunInput> {
  const summary = await buildChatSummary(deps.db, input);
  await insertCompaction(deps.db, {
    conversationId: input.identity.threadId,
    runId: lease.runId,
    sessionRowId: candidate.session.id,
    agentKey: candidate.session.agentKey,
    method: 'spark',
    tokensBefore: candidate.reading.used,
    tokensAfter: null,
    contextSize: candidate.reading.size,
    summary,
    lastMessageId: input.previousMessageId ?? null,
  });
  await closeKeyedSessions(
    deps.db,
    input.identity.threadId,
    'chat:',
    SESSION_CLOSE_REASONS.compacted,
  );
  await notice(
    append,
    `Compacted the chat with a Spark summary (${kilo(candidate.reading.used)} tokens before)`,
  );
  return { ...input, seed: { text: summary, historyFrom: input.history.length } };
}

async function compactNow(
  deps: TurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: Pick<RunControl, 'signal'>,
  candidate: Candidate,
): Promise<BeforeTurn> {
  const byAgent = await compactWithAgent(deps, lease, input, append, control, candidate);
  if (control.signal.aborted) return { kind: 'stopped' };
  if (byAgent) return { kind: 'continue', input: byAgent };
  return { kind: 'continue', input: await compactWithSpark(deps, lease, input, append, candidate) };
}

async function moveToFreshChat(
  deps: TurnDeps,
  input: RunInput,
  candidate: Candidate,
): Promise<BeforeTurn> {
  const summary = await buildChatSummary(deps.db, input);
  const chat = await startFreshChat(deps.db, input, summary, candidate.reading);
  await closeKeyedSessions(
    deps.db,
    input.identity.threadId,
    'chat:',
    SESSION_CLOSE_REASONS.movedToFreshChat,
  );
  return { kind: 'moved', chat };
}

export async function compactBeforeTurn(
  deps: BeforeTurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: Pick<RunControl, 'signal'>,
): Promise<BeforeTurn> {
  const keep: BeforeTurn = { kind: 'continue', input };
  if (input.parentRunId !== null) return keep;
  if (input.assistant) await deps.assistantIdle?.wait(input.identity.threadId);
  const candidate = await candidateFor(deps, input);
  if (!candidate) return keep;
  const thresholds = await compactionThresholds(deps.db, input.workspaceId);
  const step = compactStep({
    thresholds,
    reading: candidate.reading,
    snoozed: candidate.session.compactSnoozed,
    cardPending: await pendingCardInChat(deps.db, input.identity.threadId),
  });
  if (step === 'none') return keep;
  if (input.assistant) {
    const compacted = await compactNow(deps, lease, input, append, control, candidate);
    await recordAssistantEvent(
      deps.db,
      input.workspaceId,
      'compacted_threshold',
      `${usedPercent(candidate.reading)}% full`,
      lease.runId,
    );
    return compacted;
  }
  if (step === 'compact') return compactNow(deps, lease, input, append, control, candidate);
  const answer = await askFirst(deps, lease, input, append, control, candidate.reading, thresholds);
  if (answer.type === 'stopped') return { kind: 'stopped' };
  if (answer.type === 'timeout') return keep;
  if (answer.optionId === CHECKPOINT_OPTION.compactNow) {
    return compactNow(deps, lease, input, append, control, candidate);
  }
  if (answer.optionId === CHECKPOINT_OPTION.freshChat) {
    return moveToFreshChat(deps, input, candidate);
  }
  await snoozeCompaction(deps.db, candidate.session.id);
  return keep;
}
