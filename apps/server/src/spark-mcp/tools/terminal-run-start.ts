import { createHash, randomUUID } from 'node:crypto';
import {
  AGENT_TERMINAL_TOOL,
  agentTerminalLive,
  agentTerminalName,
} from '@spark-outpost/contracts';
import { redactText } from '../../audit/redact.ts';
import { askAgentTerminalStop } from '../../persistence/agent-terminal-changes.ts';
import {
  chatAgentTerminals,
  startAgentTerminal,
  type AgentTerminalRow,
} from '../../persistence/agent-terminals.ts';
import { getApproval } from '../../persistence/approvals.ts';
import { shotAnchor } from '../../persistence/browser-screenshots.ts';
import type { Db } from '../../persistence/db.ts';
import { LeaseLostError, isCancelRequested } from '../../persistence/run-events.ts';
import { createApprovalGate } from '../../workflow/approval-gate.ts';
import {
  reviewSparkCommand,
  sparkCommandAsked,
  sparkCommandStarted,
  type SparkCommandReview,
  type SparkCommandScope,
} from '../../workflow/command-gate.ts';
import { runEvents } from '../../workflow/run-events.ts';
import { auditTerminalStart, recordTerminalStop } from '../../workflow/terminal-audit.ts';
import type { SparkActionHooks } from '../deps.ts';
import type { SparkToolContext } from '../tool.ts';
import { folderProblem, resolveFolder } from './terminal-run-folder.ts';

export const NO_TURN_REASON = 'A Spark terminal starts only from a turn in a chat';
export const CARD_CLOSED_REASON =
  'The card closed before you answered it, so the command did not start';
export const TURN_ENDED_REASON = 'The turn ended before the command could start';

export interface TerminalStart {
  command: string;
  name?: string | undefined;
  cwd?: string | undefined;
}

export type StartOutcome =
  { started: true; row: AgentTerminalRow } | { started: false; reason: string };

interface StartRun {
  db: Db;
  runId: string;
  conversationId: string;
  hooks: SparkActionHooks;
  scope: SparkCommandScope;
  signal: AbortSignal;
}

type Passed = Extract<SparkCommandReview, { verdict: 'allow' | 'ask' }>;

type Decided =
  | { allowed: true; approvalId: string | null }
  | { allowed: false; reason: string; approvalId: string | null };

async function currentMode(db: Db, runId: string): Promise<string | null> {
  const { rows } = await db.query<{ mode: string | null }>(
    'SELECT COALESCE(used_mode, agent_mode) AS mode FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.mode ?? null;
}

async function startRun({ deps, scope, signal }: SparkToolContext): Promise<StartRun | null> {
  const { runId, conversationId, actions: hooks, commands } = scope;
  if (!runId || !conversationId || !hooks || !commands) return null;
  const mode = (await currentMode(deps.db, runId)) ?? commands.agentMode;
  return {
    db: deps.db,
    runId,
    conversationId,
    hooks,
    scope: { ...commands, agentMode: mode },
    signal: signal ? AbortSignal.any([hooks.signal, signal]) : hooks.signal,
  };
}

function toolCallIdFor(callId: string | undefined, command: string, folder: string | null) {
  if (callId === undefined) return `${AGENT_TERMINAL_TOOL}:${randomUUID()}`;
  const asked = createHash('sha256')
    .update(JSON.stringify([command, folder]))
    .digest('hex');
  return `${AGENT_TERMINAL_TOOL}:${callId}:${asked.slice(0, 16)}`;
}

interface Earlier {
  live: AgentTerminalRow | null;
  toolCallId: string;
}

async function earlierCalls(run: StartRun, toolCallId: string): Promise<Earlier> {
  const rows = await chatAgentTerminals(run.db, run.conversationId);
  const same = rows.filter(
    (row) => row.runId === run.runId && row.toolCallId?.startsWith(toolCallId),
  );
  return {
    live: same.find((row) => agentTerminalLive(row.status)) ?? null,
    toolCallId: same.length === 0 ? toolCallId : `${toolCallId}:${same.length}`,
  };
}

async function decided(run: StartRun, review: Passed): Promise<Decided> {
  if (review.verdict === 'allow') return { allowed: true, approvalId: null };
  const gate = createApprovalGate({
    db: run.db,
    runId: run.runId,
    provider: run.scope.provider,
    mode: run.scope.agentMode,
    append: run.hooks.append,
    waiters: run.hooks.waiters,
    pollMs: run.hooks.pollMs,
    timeoutMs: run.hooks.timeoutMs,
    onTimeout: run.hooks.onTimeout ?? (() => undefined),
    backup: async () => undefined,
    park: run.hooks.park,
  });
  const answer = await gate.raise(review.card, review.request, run.signal, (approvalId) =>
    sparkCommandAsked(run.scope, review, approvalId),
  );
  if (answer.outcome === 'selected' && answer.allowed && answer.approvalId) {
    return { allowed: true, approvalId: answer.approvalId };
  }
  const approvalId = answer.outcome === 'selected' ? (answer.approvalId ?? null) : null;
  const card = approvalId ? await getApproval(run.db, approvalId) : null;
  const reason = card && card.status !== 'denied' ? CARD_CLOSED_REASON : answer.note;
  return { allowed: false, reason, approvalId };
}

async function announce(run: StartRun, row: AgentTerminalRow): Promise<void> {
  const started = runEvents.agentTerminalStarted({
    id: row.id,
    name: redactText(row.name),
    command: redactText(row.command),
    cwd: row.cwd,
    startedAt: row.startedAt.toISOString(),
    textOffset: row.textOffset,
    textBefore: row.textBefore,
    textHeld: row.textHeld,
  });
  try {
    await run.hooks.append(started);
  } catch (error) {
    if (!(error instanceof LeaseLostError)) throw error;
  }
}

async function stoppedWithTurn(run: StartRun, row: AgentTerminalRow): Promise<AgentTerminalRow> {
  const turnStopped = run.hooks.signal.aborted || (await isCancelRequested(run.db, run.runId));
  if (!turnStopped) return row;
  const stopped = await askAgentTerminalStop(run.db, row.id, 'turn_stopped');
  if (stopped?.stoppedBy !== 'turn_stopped') return stopped ?? row;
  await recordTerminalStop(run.db, stopped, 'turn_stopped').catch(() => undefined);
  return stopped;
}

function refused(
  run: StartRun,
  review: SparkCommandReview,
  reason: string,
  approvalId: string | null = null,
): StartOutcome {
  auditTerminalStart(run.hooks.audit, {
    ...review.audit,
    decision: 'refused',
    reason,
    unreviewed: false,
    terminalId: null,
    approvalId,
  });
  return { started: false, reason };
}

export async function startTerminal(
  context: SparkToolContext,
  start: TerminalStart,
): Promise<StartOutcome> {
  const run = await startRun(context);
  if (!run) return { started: false, reason: NO_TURN_REASON };
  const folder = resolveFolder(run.scope.roots, start.cwd);
  const earlier = await earlierCalls(run, toolCallIdFor(context.callId, start.command, folder));
  if (earlier.live) return { started: true, row: earlier.live };
  const { toolCallId } = earlier;
  const review = await reviewSparkCommand(run.scope, {
    toolCallId,
    command: start.command,
    cwd: folder,
  });
  if (review.verdict === 'refuse') return refused(run, review, review.reason);
  const missing = await folderProblem(run.scope.roots, review.request.cwd ?? '');
  if (missing) return refused(run, review, missing);
  const decision = await decided(run, review);
  if (!decision.allowed) return refused(run, review, decision.reason, decision.approvalId);
  const anchor = run.hooks.replySoFar?.();
  const created = await startAgentTerminal(run.db, {
    runId: run.runId,
    toolCallId,
    name: start.name ?? agentTerminalName(start.command),
    command: start.command,
    cwd: review.request.cwd ?? '',
    decidedBy: decision.approvalId ? 'card' : 'mode',
    approvalId: decision.approvalId,
    ...(anchor
      ? shotAnchor(anchor.shown, anchor.held)
      : { textOffset: null, textBefore: null, textHeld: null }),
  });
  if (!created) return refused(run, review, TURN_ENDED_REASON);
  if (!created.created) return { started: true, row: created.row };
  sparkCommandStarted(run.scope, review, decision.approvalId);
  auditTerminalStart(run.hooks.audit, {
    ...review.audit,
    terminalId: created.row.id,
    approvalId: decision.approvalId,
  });
  await announce(run, created.row);
  return { started: true, row: await stoppedWithTurn(run, created.row) };
}
