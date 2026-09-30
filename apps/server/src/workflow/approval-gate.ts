import path from 'node:path';
import {
  modeKind,
  modePosture,
  type AgentModeOption,
  type ModePosture,
  type Approval,
  type ApprovalOption,
  type ApprovalPayload,
  type RunEvent,
} from '@spark-outpost/contracts';
import { normalizeCommand } from '../approvals/commands.ts';
import { forcePush } from '../approvals/git-commands.ts';
import { defaultBranch } from '../projects/chat-worktrees.ts';
import { pieceRefusal, type PieceGuard } from '../approvals/piece-guard.ts';
import {
  FS_WRITE_TOOL_KIND,
  decide,
  relativeTo,
  type ApprovalRequest,
  type Decision,
  type RunRule,
  type RunRules,
} from '../approvals/decide.ts';
import {
  allowedForRun,
  rejectedForRun,
  getApproval,
  insertApproval,
  projectAllowlistForRun,
  settlePending,
  type NewApproval,
} from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import { awaitDepsPrep } from '../projects/deps-prep.ts';
import { LeaseLostError, type AppendOptions } from '../persistence/run-events.ts';
import type { GateAnswer, PermissionGate } from '../providers/provider.ts';
import type { Append } from './agent-turn.ts';
import { waitForApproval, type ApprovalWaiters, type WaitResult } from './approval-waiters.ts';
import { runEvents } from './run-events.ts';

const afterQueuedUpdates = () => new Promise<void>((resolve) => setImmediate(resolve));

export const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;
export const APPROVAL_POLL_MS = 1000;
export const APPROVAL_TIMEOUT_MESSAGE = 'Approval timed out';

const DIFF_BUDGET = 64 * 1024;

export interface ObservedDecision {
  verdict: 'allow' | 'reject' | 'ask';
  by: string | null;
  approvalId: string | null;
}

export type EditObserver = (request: ApprovalRequest, decision: ObservedDecision) => void;

export interface PlanModeHooks {
  proposed(request: ApprovalRequest & { plan: string }): Promise<string | null>;
  decided(planId: string, answer: GateAnswer): Promise<void>;
}

export interface GateDeps {
  db: Db;
  runId: string;
  provider: string;
  mode: string | null;
  modes?: readonly AgentModeOption[];
  posture?: ModePosture;
  builder?: boolean;
  askRun?: boolean;
  askAuto?: () => Promise<string | null>;
  worktreeAuto?: boolean;
  extraAllowlist?: () => readonly string[];
  append: Append;
  waiters: ApprovalWaiters;
  pollMs?: number;
  timeoutMs?: number;
  onTimeout: () => void;
  backup: (paths: readonly string[]) => Promise<void>;
  copyOf?: string | null;
  observe?: EditObserver;
  plans?: PlanModeHooks;
  piece?: PieceGuard;
}

function relativeLabel(request: ApprovalRequest, target: string): string {
  for (const root of request.roots) {
    const relative = path.relative(root.path, target);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return request.roots.length > 1 ? `${path.basename(root.path)}/${relative}` : relative;
    }
  }
  return target;
}

function displayTitle(request: ApprovalRequest, copyOf: string | null): string {
  const title = request.title.trim() || 'an action';
  const shown = request.paths.reduce(
    (text, target) => text.replaceAll(target, relativeLabel(request, target)),
    title,
  );
  return copyOf ? `${shown} · ${copyLabel(copyOf)}` : shown;
}

export function copyLabel(name: string): string {
  return `${name}'s copy`;
}

export function subject(request: ApprovalRequest): string {
  if (request.kind === 'execute' && request.command) {
    return `\`${request.command.replace(/\s+/g, ' ').trim()}\``;
  }
  if (request.kind === 'edit' && request.paths.length > 0) {
    const verb = request.toolKind === 'delete' ? 'Delete' : 'Edit';
    return `${verb} ${request.paths.map((target) => `\`${relativeLabel(request, target)}\``).join(', ')}`;
  }
  return request.title.trim() || 'an action';
}

type Asking = Pick<Extract<Decision, { verdict: 'ask' }>, 'forcePush' | 'because'>;

function approvalPayload(request: ApprovalRequest, asking: Asking): ApprovalPayload {
  let budget = DIFF_BUDGET;
  let truncated = false;
  const cut = (text: string) => {
    if (text.length <= budget) {
      budget -= text.length;
      return text;
    }
    truncated = true;
    const kept = text.slice(0, Math.max(0, budget));
    budget = 0;
    return kept;
  };
  const diffs = request.diffs.map((diff) => ({
    path: relativeLabel(request, diff.path),
    oldText: diff.oldText === null ? null : cut(diff.oldText),
    newText: cut(diff.newText),
  }));
  return {
    command: request.command,
    cwd: request.cwd,
    paths: request.paths.map((target) => relativeLabel(request, target)),
    fullPaths: request.paths,
    diffs,
    truncated,
    ...(request.plan ? { plan: request.plan } : {}),
    ...(asking.forcePush ? { forcePush: asking.forcePush } : {}),
    ...(asking.because ? { asksBecause: asking.because } : {}),
  };
}

async function forcePushDefault(request: ApprovalRequest): Promise<string | null> {
  const root = request.roots[0]?.path;
  if (!root || !request.command || forcePush(request.command)?.kind !== 'ask') return null;
  return defaultBranch(root).catch(() => null);
}

function allowOption(options: readonly ApprovalOption[]): ApprovalOption | undefined {
  return (
    options.find((option) => option.kind === 'allow_once') ??
    options.find((option) => option.kind === 'allow_always')
  );
}

function rejectOption(options: readonly ApprovalOption[]): ApprovalOption | undefined {
  return (
    options.find((option) => option.kind === 'reject_once') ??
    options.find((option) => option.kind === 'reject_always')
  );
}

function toRule(approval: Pick<Approval, 'kind' | 'title' | 'payload'>): RunRule | null {
  if (approval.kind === 'execute') {
    return approval.payload.command
      ? { kind: 'execute', command: normalizeCommand(approval.payload.command) }
      : null;
  }
  if (approval.kind === 'edit') return { kind: 'edit' };
  return { kind: 'other', title: approval.title };
}

function userNote(approval: Approval, what: string): string {
  if (approval.status === 'denied') return `Denied: ${what} (you denied it)`;
  if (approval.scope === 'run') return `Allowed ${what} (you allowed it for this run)`;
  if (approval.scope === 'project') return `Allowed ${what} (you always allow it in this project)`;
  return `Allowed ${what} (you allowed it)`;
}

export function createApprovalGate(deps: GateDeps): PermissionGate {
  const grants = new Set<string>();
  let waiting = 0;

  const newApproval = (
    request: ApprovalRequest,
    reason: string | null,
    asking: Asking = {},
  ): NewApproval => ({
    runId: deps.runId,
    toolCallId: request.toolCallId,
    rpcId: request.rpcId,
    kind: request.kind,
    title: displayTitle(request, deps.copyOf ?? null),
    payload: approvalPayload(request, asking),
    options: asking.forcePush
      ? request.options.filter((option) => option.kind !== 'allow_always')
      : request.options,
    reason,
  });

  const rules = async (): Promise<RunRules> => {
    const [allowed, rejected] = await Promise.all([
      allowedForRun(deps.db, deps.runId),
      rejectedForRun(deps.db, deps.runId),
    ]);
    return {
      allow: allowed.flatMap((approval) => toRule(approval) ?? []),
      reject: rejected.flatMap((approval) => toRule(approval) ?? []),
    };
  };

  const modeOf = (request: ApprovalRequest) => request.mode ?? deps.mode;
  const modeLabel = (mode: string | null) =>
    deps.modes?.find((option) => option.id === mode)?.label ?? mode ?? 'default';
  const postureOf = (request: ApprovalRequest) => {
    if (deps.posture) return deps.posture;
    const mode = modeOf(request);
    return modePosture(deps.provider, mode, modeKind(deps.modes ?? [], mode));
  };

  const allowedWhy = (
    decision: Extract<Decision, { verdict: 'allow' }>,
    request: ApprovalRequest,
  ): string => {
    if (decision.why !== undefined) return decision.why;
    if (decision.by === 'allowlist') return 'on the project allowlist';
    if (decision.by === 'run_rule') return 'allowed for this run';
    return `${modeLabel(modeOf(request))} mode`;
  };

  const observe = (request: ApprovalRequest, decision: ObservedDecision) => {
    if (!deps.observe || request.kind !== 'edit' || request.diffs.length === 0) return;
    try {
      deps.observe(request, decision);
    } catch (error) {
      console.error('Could not observe an edit request', error);
    }
  };

  const grant = async (request: ApprovalRequest) => {
    if (request.kind !== 'edit') return;
    request.paths.forEach((target) => grants.add(target));
    await deps.backup(request.paths);
  };

  const allow = async (
    request: ApprovalRequest,
    note: string,
    approvalId?: string,
  ): Promise<GateAnswer> => {
    const option = allowOption(request.options);
    if (!option)
      return { outcome: 'cancelled', note: `Declined: ${subject(request)} (no allow option)` };
    await grant(request);
    return {
      outcome: 'selected',
      optionId: option.optionId,
      allowed: true,
      note,
      ...(approvalId ? { approvalId } : {}),
    };
  };

  const reject = (
    request: ApprovalRequest,
    note: string,
    approvalId?: string,
    chosen?: string | null,
  ): GateAnswer => {
    const option =
      request.options.find((candidate) => candidate.optionId === chosen) ??
      rejectOption(request.options);
    return option
      ? {
          outcome: 'selected',
          optionId: option.optionId,
          allowed: false,
          note,
          ...(approvalId ? { approvalId } : {}),
        }
      : { outcome: 'cancelled', note };
  };

  const waitForDecision = (id: string, signal: AbortSignal): Promise<WaitResult> =>
    waitForApproval(id, {
      db: deps.db,
      waiters: deps.waiters,
      signal,
      timeoutMs: deps.timeoutMs ?? APPROVAL_TIMEOUT_MS,
      pollMs: deps.pollMs ?? APPROVAL_POLL_MS,
    });

  const emit = async (event: RunEvent, options?: AppendOptions) => {
    try {
      await deps.append(event, options);
    } catch (error) {
      if (!(error instanceof LeaseLostError)) throw error;
    }
  };

  const settle = async (
    pending: Approval,
    result: WaitResult,
    request: ApprovalRequest,
  ): Promise<GateAnswer> => {
    const what = subject(request);
    if (result === 'aborted') {
      const cancelled = await settlePending(deps.db, pending.id, {
        status: 'cancelled',
        decidedBy: 'stop',
        optionId: null,
      });
      if (cancelled) await emit(runEvents.approvalDecided(cancelled));
      return { outcome: 'cancelled', note: `Cancelled: ${what} (stopped while waiting for you)` };
    }
    if (result === 'timeout') {
      const expired = await settlePending(deps.db, pending.id, {
        status: 'expired',
        decidedBy: 'timeout',
        optionId: rejectOption(request.options)?.optionId ?? null,
      });
      if (expired) {
        await emit(runEvents.approvalDecided(expired));
        deps.onTimeout();
        return reject(request, `Declined: ${what} (${APPROVAL_TIMEOUT_MESSAGE.toLowerCase()})`);
      }
      const decided = await getApproval(deps.db, pending.id);
      return settle(pending, decided ?? 'aborted', request);
    }
    await emit(
      runEvents.approvalDecided(result),
      waiting === 0 ? { transition: { status: 'running' } } : undefined,
    );
    const note = userNote(result, what);
    if (result.status !== 'allowed' || !result.decisionOptionId) {
      return reject(request, note, result.id, result.decisionOptionId);
    }
    await grant(request);
    return {
      outcome: 'selected',
      optionId: result.decisionOptionId,
      allowed: true,
      note,
      approvalId: result.id,
    };
  };

  const ask = async (
    request: ApprovalRequest,
    reason: string | null,
    signal: AbortSignal,
    asking: Asking,
  ): Promise<GateAnswer> => {
    const pending = await insertApproval(deps.db, newApproval(request, reason, asking));
    observe(request, { verdict: 'ask', by: null, approvalId: pending.id });
    waiting += 1;
    let result: WaitResult;
    try {
      await emit(runEvents.approvalRequested(pending), {
        transition: { status: 'awaiting_approval' },
      });
      result = await waitForDecision(pending.id, signal);
    } finally {
      waiting -= 1;
    }
    return settle(pending, result, request);
  };

  const decideRequest = async (
    request: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<GateAnswer> => {
    const what = subject(request);
    await afterQueuedUpdates();
    if (signal.aborted) return { outcome: 'cancelled', note: `Cancelled: ${what} (stopped)` };
    if (request.kind === 'execute' && deps.copyOf) await awaitDepsPrep(deps.db, deps.runId);
    const pieceRefused = deps.piece
      ? pieceRefusal(request, deps.piece, relativeTo(request.roots))
      : null;
    const covered =
      pieceRefused === null &&
      request.toolKind === FS_WRITE_TOOL_KIND &&
      request.paths.length > 0 &&
      request.paths.every((target) => grants.has(target));
    if (covered) return allow(request, `Wrote ${what.replace(/^Edit /, '')}`);
    const [runRules, projectAllowlist] = await Promise.all([
      rules(),
      projectAllowlistForRun(deps.db, deps.runId),
    ]);
    if (signal.aborted) return { outcome: 'cancelled', note: `Cancelled: ${what} (stopped)` };
    const allowlist = [...projectAllowlist, ...(deps.extraAllowlist?.() ?? [])];
    const decision = decide(postureOf(request), request, runRules, allowlist, {
      builder: deps.builder === true,
      askRun: deps.askRun === true,
      askAutoWhy: request.kind === 'execute' && deps.askAuto ? await deps.askAuto() : null,
      worktreeAuto: deps.worktreeAuto === true,
      defaultBranch: await forcePushDefault(request),
      ...(deps.piece ? { piece: deps.piece } : {}),
    });
    if (decision.verdict === 'ask') {
      return ask(request, decision.reason, signal, decision);
    }
    if (decision.verdict === 'reject') {
      const denied = await insertApproval(deps.db, newApproval(request, decision.reason), {
        status: 'denied',
        decidedBy: 'policy',
        optionId: rejectOption(request.options)?.optionId ?? null,
      });
      observe(request, { verdict: 'reject', by: 'policy', approvalId: denied.id });
      return reject(request, `Declined: ${what} (${decision.reason})`, denied.id);
    }
    const option = allowOption(request.options);
    const recorded = await insertApproval(deps.db, newApproval(request, null), {
      status: option ? 'allowed' : 'denied',
      decidedBy: decision.by,
      optionId: option?.optionId ?? null,
    });
    observe(request, {
      verdict: option ? 'allow' : 'reject',
      by: decision.by,
      approvalId: recorded.id,
    });
    return allow(request, `Allowed ${what} (${allowedWhy(decision, request)})`, recorded.id);
  };

  const review = async (request: ApprovalRequest, signal: AbortSignal): Promise<GateAnswer> => {
    const plan = request.plan;
    if (!plan || !deps.plans || signal.aborted) return decideRequest(request, signal);
    const planId = await deps.plans.proposed({ ...request, plan });
    const answer = await decideRequest(request, signal);
    if (planId) await deps.plans.decided(planId, answer);
    return answer;
  };

  return { review };
}
