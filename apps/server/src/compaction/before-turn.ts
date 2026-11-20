import {
  CHECKPOINT_OPTION,
  reaskPercent,
  type CompactionSettings,
  type CompactionThresholds,
} from '@spark-outpost/contracts';
import { recordAssistantEvent } from '../companion/assistant-events.ts';
import { insertCompaction, pendingCardInChat } from '../persistence/compactions.ts';
import type { Lease } from '../persistence/jobs.ts';
import {
  SESSION_CLOSE_REASONS,
  closeKeyedSessions,
  recordCompacted,
  snoozeCompaction,
  type ContextReading,
} from '../persistence/provider-sessions.ts';
import { autoContinueSeconds, compactionThresholds } from '../persistence/setup.ts';
import { askCheckpoint, compactCard } from '../workflow/kept-record.ts';
import { kilo } from '../agents/acp/long-context.ts';
import type { Append, RunControl, TurnDeps } from '../workflow/agent-turn.ts';
import { APPROVAL_POLL_MS, APPROVAL_TIMEOUT_MS } from '../workflow/approval-gate.ts';
import { startsWithCommand, withAgentNote } from '../workflow/agent-note.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { HISTORY_TOOL_NOTE, taskDiff } from '../workflow/session-brief.ts';
import { compactInSession, leaseLog, offersCompact } from './agent-compact.ts';
import { candidateFor, type Candidate } from './candidate.ts';
import { startFreshChat, type FreshChat } from './fresh-chat.ts';
import { handoffInstructions } from './handoff-instructions.ts';
import { chatIdentifiers } from './identifiers.ts';
import { loadLiveState } from './live-state.ts';
import { naturalBreak } from './natural-break.ts';
import { agentCompactWorked, compactStep, usedPercent, type CompactTrigger } from './policy.ts';
import { buildChatSummary } from './summary.ts';
import { cardTriggerText, triggerLine } from './trigger-lines.ts';

export interface BeforeTurnDeps extends TurnDeps {
  checkpointTimeoutMs?: number;
}

export type BeforeTurn =
  { kind: 'continue'; input: RunInput } | { kind: 'moved'; chat: FreshChat } | { kind: 'stopped' };

export const AGENT_COMPACTED_NOTE = `Your context was just compacted with /compact. ${HISTORY_TOOL_NOTE}`;

interface Compacting {
  candidate: Candidate;
  trigger: CompactTrigger;
}

function cardReason(
  reading: ContextReading,
  thresholds: CompactionThresholds,
  trigger: CompactTrigger,
): string {
  const full = `The agent's context is ${usedPercent(reading)}% full (${kilo(reading.used)} of ${kilo(reading.size)} tokens).`;
  const keeps =
    'Compacting keeps the full transcript in Spark; the agent carries on from a summary.';
  const manual = thresholds.autoCompact ? '' : ' Automatic compaction is off, so Spark asks first.';
  return `${full}${cardTriggerText(trigger)} ${keeps}${manual}`;
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
  compacting: Compacting,
  thresholds: CompactionThresholds,
) {
  const seconds = await autoContinueSeconds(deps.db, input.workspaceId);
  const reason = cardReason(compacting.candidate.reading, thresholds, compacting.trigger);
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
    compactCard(reason, reaskPercent(thresholds.compactPercent)),
    1,
  );
}

function compactedNote(liveState: string, identifiers: string): string {
  return [AGENT_COMPACTED_NOTE, liveState, identifiers].filter(Boolean).join('\n\n');
}

function withIdentifiers(summary: string, identifiers: string): string | null {
  return [summary, identifiers].filter(Boolean).join('\n\n') || null;
}

async function chatLiveState(deps: TurnDeps, input: RunInput): Promise<string> {
  const root = input.projectRoots[0] ?? null;
  const diff = await taskDiff(root ?? undefined);
  return loadLiveState(deps.db, input.identity.threadId, root, diff.files);
}

async function compactWithAgent(
  deps: TurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: Pick<RunControl, 'signal'>,
  { candidate, trigger }: Compacting,
): Promise<RunInput | null> {
  if (!offersCompact(candidate.commands)) return null;
  await notice(append, `Sent /compact to the agent (${kilo(candidate.reading.used)} tokens)`);
  const liveState = await chatLiveState(deps, input);
  const compacted = await compactInSession(
    deps,
    leaseLog(deps, lease),
    input,
    candidate,
    append,
    control.signal,
    handoffInstructions(liveState, new Date()),
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
  await notice(append, triggerLine(trigger, usedPercent(candidate.reading)));
  await notice(
    append,
    `Compacted the chat: ${kilo(candidate.reading.used)} tokens → a ~${kilo(after.used)} summary; the size with the system prompt and tools shows after the next reply`,
  );
  const state = startsWithCommand(input) ? '' : liveState;
  return withAgentNote(input, compactedNote(state, identifiers));
}

async function compactWithSpark(
  deps: TurnDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  { candidate, trigger }: Compacting,
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
  await notice(append, triggerLine(trigger, usedPercent(candidate.reading)));
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
  compacting: Compacting,
): Promise<BeforeTurn> {
  const byAgent = await compactWithAgent(deps, lease, input, append, control, compacting);
  if (control.signal.aborted) return { kind: 'stopped' };
  if (byAgent) return { kind: 'continue', input: byAgent };
  return {
    kind: 'continue',
    input: await compactWithSpark(deps, lease, input, append, compacting),
  };
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

async function breakBefore(
  deps: TurnDeps,
  input: RunInput,
  reading: ContextReading,
  thresholds: CompactionSettings,
) {
  if (input.assistant || !thresholds.compactAtBreak) return null;
  if (usedPercent(reading) < thresholds.warnPercent) return null;
  return naturalBreak(deps.db, input);
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
  const decision = compactStep({
    thresholds,
    reading: candidate.reading,
    snoozed: candidate.session.compactSnoozed,
    cardPending: await pendingCardInChat(deps.db, input.identity.threadId),
    naturalBreak: await breakBefore(deps, input, candidate.reading, thresholds),
  });
  if (decision.step === 'none') return keep;
  const compacting: Compacting = { candidate, trigger: decision.trigger };
  if (input.assistant) {
    const compacted = await compactNow(deps, lease, input, append, control, compacting);
    if (compacted.kind !== 'continue') return compacted;
    await recordAssistantEvent(
      deps.db,
      input.workspaceId,
      'compacted_threshold',
      `${usedPercent(candidate.reading)}% full`,
      lease.runId,
    );
    return compacted;
  }
  if (decision.step === 'compact') {
    return compactNow(deps, lease, input, append, control, compacting);
  }
  const answer = await askFirst(deps, lease, input, append, control, compacting, thresholds);
  if (answer.type === 'stopped') return { kind: 'stopped' };
  if (answer.type === 'timeout') return keep;
  if (answer.optionId === CHECKPOINT_OPTION.compactNow) {
    return compactNow(deps, lease, input, append, control, compacting);
  }
  if (answer.optionId === CHECKPOINT_OPTION.freshChat) {
    return moveToFreshChat(deps, input, candidate);
  }
  await snoozeCompaction(deps.db, candidate.session.id);
  return keep;
}
