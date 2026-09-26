import path from 'node:path';
import {
  involvementLevelLabel,
  type Approval,
  type ApprovalOption,
  type ApprovalPayload,
  type InvolvementLevel,
  type RunEvent,
} from '@spark-outpost/contracts';
import { normalizeCommand } from '../approvals/commands.ts';
import {
  FS_WRITE_TOOL_KIND,
  decide,
  type ApprovalRequest,
  type RunRule,
} from '../approvals/decide.ts';
import {
  allowedForRun,
  getApproval,
  insertApproval,
  projectAllowlistForRun,
  settlePending,
  type NewApproval,
} from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import { LeaseLostError, type AppendOptions } from '../persistence/run-events.ts';
import type { GateAnswer, PermissionGate } from '../providers/provider.ts';
import { waitForApproval, type ApprovalWaiters, type WaitResult } from './approval-waiters.ts';
import { runEvents } from './run-events.ts';

export const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;
export const APPROVAL_POLL_MS = 1000;
export const APPROVAL_TIMEOUT_MESSAGE = 'Approval timed out';

const DIFF_BUDGET = 64 * 1024;

export interface GateDeps {
  db: Db;
  runId: string;
  level: InvolvementLevel;
  append: (event: RunEvent, options?: AppendOptions) => Promise<number>;
  waiters: ApprovalWaiters;
  pollMs?: number;
  timeoutMs?: number;
  onTimeout: () => void;
  backup: (paths: readonly string[]) => Promise<void>;
  copyOf?: string | null;
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

export function approvalPayload(request: ApprovalRequest): ApprovalPayload {
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
  };
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

  const newApproval = (request: ApprovalRequest, reason: string | null): NewApproval => ({
    runId: deps.runId,
    toolCallId: request.toolCallId,
    rpcId: request.rpcId,
    kind: request.kind,
    title: displayTitle(request, deps.copyOf ?? null),
    payload: approvalPayload(request),
    options: request.options,
    reason,
  });

  const rules = async (): Promise<RunRule[]> => {
    const allowed = await allowedForRun(deps.db, deps.runId);
    return allowed.flatMap((approval) => toRule(approval) ?? []);
  };

  const grant = async (request: ApprovalRequest) => {
    if (request.kind !== 'edit') return;
    request.paths.forEach((target) => grants.add(target));
    await deps.backup(request.paths);
  };

  const allow = async (request: ApprovalRequest, note: string): Promise<GateAnswer> => {
    const option = allowOption(request.options);
    if (!option)
      return { outcome: 'cancelled', note: `Declined: ${subject(request)} (no allow option)` };
    await grant(request);
    return { outcome: 'selected', optionId: option.optionId, allowed: true, note };
  };

  const reject = (request: ApprovalRequest, note: string): GateAnswer => {
    const option = rejectOption(request.options);
    return option
      ? { outcome: 'selected', optionId: option.optionId, allowed: false, note }
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
    if (result.status !== 'allowed' || !result.decisionOptionId) return reject(request, note);
    await grant(request);
    return { outcome: 'selected', optionId: result.decisionOptionId, allowed: true, note };
  };

  const ask = async (
    request: ApprovalRequest,
    reason: string | null,
    signal: AbortSignal,
  ): Promise<GateAnswer> => {
    const pending = await insertApproval(deps.db, newApproval(request, reason));
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

  const review = async (request: ApprovalRequest, signal: AbortSignal): Promise<GateAnswer> => {
    const what = subject(request);
    if (signal.aborted) return { outcome: 'cancelled', note: `Cancelled: ${what} (stopped)` };
    const covered =
      request.toolKind === FS_WRITE_TOOL_KIND &&
      request.paths.length > 0 &&
      request.paths.every((target) => grants.has(target));
    if (covered) return allow(request, `Wrote ${what.replace(/^Edit /, '')}`);
    const [runRules, allowlist] = await Promise.all([
      rules(),
      projectAllowlistForRun(deps.db, deps.runId),
    ]);
    const decision = decide(deps.level, request, runRules, allowlist);
    if (decision.verdict === 'ask') return ask(request, decision.reason, signal);
    if (decision.verdict === 'reject') {
      await insertApproval(deps.db, newApproval(request, decision.reason), {
        status: 'denied',
        decidedBy: 'policy',
        optionId: rejectOption(request.options)?.optionId ?? null,
      });
      return reject(request, `Declined: ${what} (${decision.reason})`);
    }
    const option = allowOption(request.options);
    await insertApproval(deps.db, newApproval(request, null), {
      status: option ? 'allowed' : 'denied',
      decidedBy: decision.by,
      optionId: option?.optionId ?? null,
    });
    const why =
      decision.by === 'allowlist'
        ? 'on the project allowlist'
        : decision.by === 'run_rule'
          ? 'allowed for this run'
          : `your ${involvementLevelLabel(deps.level)} setting`;
    return allow(request, `Allowed ${what} (${why})`);
  };

  return { review };
}
