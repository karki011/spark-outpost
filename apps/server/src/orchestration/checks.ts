import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  CHECK_TOOL_CALL_PREFIX,
  checkStatusOf,
  type CheckBody,
  type CheckResult,
} from '@spark-outpost/contracts';
import { redactValue } from '../audit/redact.ts';
import type { CheckCommand } from '../checks/detect.ts';
import { checkScriptChanged } from '../checks/project-checks.ts';
import { CHECK_TIMEOUT_MS, runCheck } from '../checks/run-check.ts';
import { refreshDependencies, type DepsRefresh } from '../projects/deps-refresh.ts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { insertProtocolEntries } from '../persistence/audit-log.ts';
import { createApprovalGate } from '../workflow/approval-gate.ts';
import { ApprovalWaiters } from '../workflow/approval-waiters.ts';
import {
  UNFINISHED_NOTE,
  attributed,
  closeRound,
  openRound,
  staleResult,
  type PlannedCheck,
  type Round,
} from './check-attribution.ts';
import { checkMemory, fixAlreadyTried } from './check-results.ts';
import { CheckpointTimeout } from './checkpoint.ts';
import { appendNewArtifact, publish, type Session } from './session.ts';

const SCRIPTS_CHANGED_NOTE =
  'The package.json script this check runs changed during this run, so it was not run automatically.';

export interface CheckTarget {
  runId: string;
  name: string;
  cwd: string;
  copy: string | null;
  env?: Readonly<Record<string, string>>;
  before?: string | null;
}

function checkRequest(check: CheckCommand, target: CheckTarget, root: string): ApprovalRequest {
  return {
    toolCallId: `${CHECK_TOOL_CALL_PREFIX}${randomUUID()}`,
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: `Run check: ${check.command}`,
    command: check.command,
    cwd: target.cwd,
    paths: [],
    diffs: [],
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'allow-run', name: 'Allow for this run', kind: 'allow_always' },
      { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
    ],
    roots: [{ path: root, ignore: [] }],
    home: homedir(),
  };
}

async function approvalIdFor(s: Session, toolCallId: string): Promise<string | null> {
  const { rows } = await s.deps.db.query<{ id: string }>(
    'SELECT id FROM approvals WHERE run_id = $1 AND tool_call_id = $2 ORDER BY created_at DESC LIMIT 1',
    [s.lease.runId, toolCallId],
  );
  return rows[0]?.id ?? null;
}

function notRun(
  check: CheckCommand,
  outcome: 'skipped' | 'denied',
  note: string,
  approvalId: string | null = null,
): CheckResult {
  return {
    command: check.command,
    kind: check.kind,
    outcome,
    exitCode: null,
    durationMs: 0,
    outputTail: '',
    truncated: false,
    note,
    approvalId,
  };
}

function relativeCwd(root: string, cwd: string): string {
  return path.relative(root, cwd) || '.';
}

async function audit(s: Session, target: CheckTarget, result: CheckResult, root: string) {
  const payload = redactValue({
    command: result.command,
    cwd: relativeCwd(root, target.cwd),
    copy: target.copy,
    builderRunId: target.runId,
    outcome: result.outcome,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    note: result.note,
    cause: result.cause ?? null,
    scope: result.scope ?? null,
    baseline: result.baseline ?? null,
    failures: result.failures ?? [],
    outputTail: result.outputTail,
  });
  await insertProtocolEntries(s.deps.db, s.lease, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'check',
      method: 'check/run',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: result.truncated,
      payload,
    },
  ]);
}

const recordQueues = new Map<string, Promise<void>>();

export function queueRecord(taskId: string, write: () => Promise<void>): Promise<void> {
  const next = (recordQueues.get(taskId) ?? Promise.resolve()).then(write);
  const settled = next.catch(() => undefined);
  recordQueues.set(taskId, settled);
  void settled.then(() => {
    if (recordQueues.get(taskId) === settled) recordQueues.delete(taskId);
  });
  return next;
}

async function record(s: Session, body: CheckBody): Promise<void> {
  const taskId = s.taskId;
  if (!taskId) return;
  await queueRecord(taskId, () => appendNewArtifact(s, taskId, 'check', body));
}

function checkGate(s: Session, target: CheckTarget, timedOut: () => void) {
  return createApprovalGate({
    db: s.deps.db,
    runId: s.lease.runId,
    provider: s.input.provider,
    mode: s.input.agentMode,
    ...(s.input.level === 'full-auto' ? { posture: 'full_access' as const } : {}),
    append: s.append,
    waiters: s.deps.approvalWaiters ?? new ApprovalWaiters(),
    ...(s.deps.approvalPollMs === undefined ? {} : { pollMs: s.deps.approvalPollMs }),
    ...(s.deps.approvalTimeoutMs === undefined ? {} : { timeoutMs: s.deps.approvalTimeoutMs }),
    onTimeout: timedOut,
    backup: async () => undefined,
    copyOf: target.copy,
  });
}

async function auditDeps(s: Session, target: CheckTarget, refresh: DepsRefresh, root: string) {
  const payload = {
    command: refresh.command,
    cwd: relativeCwd(root, target.cwd),
    reason: 'The lockfile changed during this run.',
    lockfileMatched: false,
    outcome: refresh.installed ? 'installed' : 'failed',
    durationMs: refresh.durationMs,
  };
  await insertProtocolEntries(s.deps.db, s.lease, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'check',
      method: 'deps/install',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}

async function runOne(
  s: Session,
  planned: PlannedCheck,
  target: CheckTarget,
  root: string,
  round: Round,
): Promise<CheckResult | null> {
  const { check } = planned;
  const scripts = s.checks?.scripts ?? '';
  const own = planned.whole ?? check;
  if (await checkScriptChanged(own, scripts, target.cwd)) {
    return notRun(check, 'skipped', SCRIPTS_CHANGED_NOTE);
  }
  const whole = planned.scope?.whole ?? check.command;
  if (checkMemory(s).unfinished.has(whole)) return notRun(check, 'skipped', UNFINISHED_NOTE);
  if (round.stale) return staleResult(check, round.stale);
  let timedOut = false;
  const request = checkRequest(check, target, root);
  const answer = await checkGate(s, target, () => (timedOut = true)).review(
    request,
    s.control.signal,
  );
  if (timedOut) throw new CheckpointTimeout();
  const approvalId = await approvalIdFor(s, request.toolCallId);
  if (answer.outcome === 'cancelled' && s.control.signal.aborted) return null;
  if (answer.outcome !== 'selected' || !answer.allowed) {
    return notRun(check, 'denied', answer.note ?? 'Not allowed.', approvalId);
  }
  const run = await runCheck(check, {
    root,
    cwd: target.cwd,
    timeoutMs: round.limitMs,
    signal: s.control.signal,
    ...(target.env ? { builderEnv: target.env } : {}),
  });
  if (run.cancelled) return null;
  const outcome = await attributed(planned, run, round);
  if (outcome === null) return null;
  if (outcome === 'retry_whole') {
    return runOne(
      s,
      { check: planned.whole ?? check, scope: null, whole: null },
      target,
      root,
      round,
    );
  }
  if (outcome.outcome === 'timed_out') checkMemory(s).unfinished.add(whole);
  return { ...outcome, approvalId };
}

export async function runChecks(
  s: Session,
  target: CheckTarget,
  scoped: readonly CheckCommand[] | null = null,
): Promise<CheckBody | null> {
  const root = s.input.projectRoots[0];
  const commands = scoped ?? s.checks?.commands;
  if (!commands || !root) return null;
  const deps = await refreshDependencies(target.cwd, {
    root,
    before: target.before ?? null,
    signal: s.control.signal,
  });
  if (!deps) return null;
  if (deps.refresh) await auditDeps(s, target, deps.refresh, root);
  s.checkRounds += 1;
  const round = await openRound(s, target.cwd, {
    commands,
    scope: scoped === null && s.checks?.source === 'detected',
    stale: deps.stale,
    limitMs: s.deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS,
    ...(target.env ? { env: target.env } : {}),
  });
  const results: CheckResult[] = [];
  try {
    for (const planned of round.planned) {
      const result = await runOne(s, planned, target, root, round);
      if (!result) return null;
      results.push(result);
      await audit(s, target, result, root);
    }
  } finally {
    await closeRound(round);
  }
  const body: CheckBody = {
    runId: target.runId,
    name: target.name,
    copy: target.copy,
    round: s.checkRounds,
    status: checkStatusOf(results),
    results,
  };
  if (await fixAlreadyTried(s, body)) body.leftForUser = true;
  s.checkBodies.push(body);
  await record(s, body);
  await publish(s);
  return body;
}
