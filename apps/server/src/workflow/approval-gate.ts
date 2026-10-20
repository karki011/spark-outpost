import {
  APPROVAL_TIMED_OUT,
  APPROVAL_WAIT_MINUTES,
  modeKind,
  modePosture,
  type AgentModeOption,
  type ModePosture,
  type Approval,
  type RunEvent,
} from '@spark-outpost/contracts';
import { forcePush } from '../approvals/git-commands.ts';
import { defaultBranch } from '../projects/chat-worktrees.ts';
import type { PublishGrant } from '../approvals/publish-policy.ts';
import { publishContext } from './publish-context.ts';
import { ownRepoFor } from './send-context.ts';
import { diskFiles } from '../approvals/file-lister.ts';
import { withPrefetchedFiles } from '../approvals/prefetched-files.ts';
import { secretReadLabels } from '../approvals/secret-reads.ts';
import { secretSend } from '../approvals/secret-send.ts';
import {
  FS_WRITE_TOOL_KIND,
  decide,
  secretLabels,
  type ApprovalRequest,
  type DecideOptions,
  type Decision,
  type RunRules,
} from '../approvals/decide.ts';
import {
  allowedForRun,
  chatInstructionGrants,
  rejectedForRun,
  getApproval,
  insertApproval,
  projectAllowlistForRun,
  settlePending,
  type NewApproval,
} from '../persistence/approvals.ts';
import type { Db } from '../persistence/db.ts';
import { ghRulesForRun } from '../persistence/spark-rules.ts';
import { LeaseLostError, type AppendOptions } from '../persistence/run-events.ts';
import type { GateAnswer, PermissionGate } from '../providers/provider.ts';
import type { RunObservations } from '../observations/run-observations.ts';
import type { Append } from './agent-turn.ts';
import { waitForApproval, type ApprovalWaiters, type WaitResult } from './approval-waiters.ts';
import { chosenModeWhy } from './ask-auto.ts';
import { runEvents } from './run-events.ts';
import { approvalPayload, displayTitle, subject } from './approval-payload.ts';
import { parseShell } from '../approvals/shell-parse.ts';
import { blockedNote, policyDenial } from '../approvals/policy-blocked.ts';
import {
  allowOption,
  askedOptions,
  rejectOption,
  toRule,
  userNote,
  type Asking,
} from './approval-options.ts';

const afterQueuedUpdates = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Weighed {
  decision: Decision;
  secretReads: string[];
}

const UNDECIDED: Weighed = { decision: { verdict: 'ask', reason: null }, secretReads: [] };

export const APPROVAL_TIMEOUT_MS = APPROVAL_WAIT_MINUTES * 60 * 1000;
export const APPROVAL_POLL_MS = 1000;
export const APPROVAL_TIMEOUT_MESSAGE = APPROVAL_TIMED_OUT;

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
  changesProject?: boolean;
  askRun?: boolean;
  askAuto?: () => Promise<string | null>;
  extraAllowlist?: () => readonly string[];
  append: Append;
  waiters: ApprovalWaiters;
  pollMs?: number;
  timeoutMs?: number;
  onTimeout: () => void;
  backup: (paths: readonly string[]) => Promise<void>;
  observe?: EditObserver;
  plans?: PlanModeHooks;
  observations?: RunObservations | undefined;
  publish?: PublishGrant | undefined;
}

export async function forcePushDefault(request: ApprovalRequest): Promise<string | null> {
  const root = request.roots[0]?.path;
  if (!root || !request.command || forcePush(request.command)?.kind !== 'ask') return null;
  return defaultBranch(root).catch(() => null);
}

function policyBlocked(answer: GateAnswer): GateAnswer {
  if (answer.outcome !== 'selected') return answer;
  return { ...answer, denial: policyDenial(answer.note) };
}

export interface ApprovalGate extends PermissionGate {
  raise(
    card: NewApproval,
    request: ApprovalRequest,
    signal: AbortSignal,
    asked: (approvalId: string) => void,
  ): Promise<GateAnswer>;
}

export function createApprovalGate(deps: GateDeps): ApprovalGate {
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
    title: displayTitle(request),
    payload: approvalPayload(request, asking),
    options: askedOptions(request.options, asking),
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

  const planningWhy = (request: ApprovalRequest) => {
    if (deps.posture || postureOf(request) !== 'read_only') return null;
    return chosenModeWhy(deps.provider, deps.mode, deps.modes ?? []);
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

  const raise = async (
    card: NewApproval,
    request: ApprovalRequest,
    signal: AbortSignal,
    asked: (approvalId: string) => void,
  ): Promise<GateAnswer> => {
    const pending = await insertApproval(deps.db, card);
    asked(pending.id);
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

  const ask = async (
    request: ApprovalRequest,
    reason: string | null,
    signal: AbortSignal,
    asking: Asking,
  ): Promise<GateAnswer> => {
    const answer = await raise(newApproval(request, reason, asking), request, signal, (id) => {
      observe(request, { verdict: 'ask', by: null, approvalId: id });
      if (!asking.observed) return;
      deps.observations?.egressAsked({
        approvalId: id,
        subject: subject(request),
        reason,
        observed: asking.observed,
        sendsTo: asking.sendsTo,
      });
    });
    const secretAllowed = asking.secretFiles !== undefined && answer.outcome === 'selected';
    return secretAllowed ? readSecrets(answer, secretLabels(request)) : answer;
  };

  const readSecrets = (answer: GateAnswer, labels: readonly string[]): GateAnswer => {
    if (answer.outcome !== 'selected' || !answer.allowed) return answer;
    for (const label of labels) deps.observations?.record({ source: 'secret_file', label });
    return answer;
  };

  const decideRequest = async (
    request: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<GateAnswer> => {
    const what = subject(request);
    await afterQueuedUpdates();
    if (signal.aborted) return { outcome: 'cancelled', note: `Cancelled: ${what} (stopped)` };
    const covered =
      request.toolKind === FS_WRITE_TOOL_KIND &&
      request.paths.length > 0 &&
      request.paths.every((target) => grants.has(target));
    if (covered) return allow(request, `Wrote ${what.replace(/^Edit /, '')}`);
    const [runRules, projectAllowlist, instructionGrants] = await Promise.all([
      rules(),
      projectAllowlistForRun(deps.db, deps.runId),
      chatInstructionGrants(deps.db, deps.runId),
    ]);
    if (signal.aborted) return { outcome: 'cancelled', note: `Cancelled: ${what} (stopped)` };
    const allowlist = [...projectAllowlist, ...(deps.extraAllowlist?.() ?? [])];
    const options: DecideOptions = {
      changesProject: deps.changesProject === true,
      askRun: deps.askRun === true,
      askAutoWhy: request.kind === 'execute' && deps.askAuto ? await deps.askAuto() : null,
      planningWhy: planningWhy(request),
      defaultBranch: await forcePushDefault(request),
      observed: (await deps.observations?.labels()) ?? [],
      own: await ownRepoFor(deps.db, deps.runId, request),
      secretSend: await secretSend(request),
      instructionGrants,
      shell: request.kind === 'execute' ? await parseShell(request.command) : null,
      agentAsks: Boolean(request.agentReason),
      ghRules: await ghRulesForRun(deps.db, deps.runId),
      ...(await publishContext(deps.db, deps.publish, request)),
    };
    const { decision, secretReads } = await withPrefetchedFiles(
      diskFiles,
      (files): Weighed => ({
        decision: decide(postureOf(request), request, runRules, allowlist, { ...options, files }),
        secretReads: secretReadLabels(request, files, options.shell ?? null),
      }),
      UNDECIDED,
    );
    if (decision.verdict === 'ask') {
      return readSecrets(await ask(request, decision.reason, signal, decision), secretReads);
    }
    if (decision.verdict === 'reject') {
      const ruled = decision.sparkRule ? { sparkRule: decision.sparkRule } : {};
      const denied = await insertApproval(deps.db, newApproval(request, decision.reason, ruled), {
        status: 'denied',
        decidedBy: 'policy',
        optionId: rejectOption(request.options)?.optionId ?? null,
      });
      observe(request, { verdict: 'reject', by: 'policy', approvalId: denied.id });
      if (decision.sparkRule) await emit(runEvents.approvalDecided(denied));
      return policyBlocked(reject(request, blockedNote(what, decision.reason), denied.id));
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
    const allowed = await allow(
      request,
      `Allowed ${what} (${allowedWhy(decision, request)})`,
      recorded.id,
    );
    if (decision.sent && allowed.outcome === 'selected') {
      deps.observations?.sentOut({
        toolCallId: request.toolCallId,
        subject: what,
        approvalId: recorded.id,
        ...decision.sent,
      });
    }
    return readSecrets(allowed, secretReads);
  };

  const review = async (request: ApprovalRequest, signal: AbortSignal): Promise<GateAnswer> => {
    const plan = request.plan;
    if (!plan || !deps.plans || signal.aborted) return decideRequest(request, signal);
    const planId = await deps.plans.proposed({ ...request, plan });
    const answer = await decideRequest(request, signal);
    if (planId) await deps.plans.decided(planId, answer);
    return answer;
  };

  return { review, raise };
}
